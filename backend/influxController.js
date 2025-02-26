import {Point} from '@influxdata/influxdb-client';
import dotenv from 'dotenv';
dotenv.config();
import {queryApi, alertWriteApi, orgsAPI, checksAPI} from '../influxClient.js';
import Joi from 'joi';

const devListSchema = Joi.object({
  bucketName: Joi.string().pattern(/^[a-zA-Z0-9_]+$/).min(3).max(30).required(),
  measurement: Joi.string().alphanum().min(3).max(30).required(),
  field: Joi.string().regex(/^\w+$/).optional(),
  start: Joi.string().default('-168h'),
  stop: Joi.string().default('now()'),
});
const dataSchema = Joi.object({
  bucketName: Joi.string().pattern(/^[a-zA-Z0-9_]+$/).min(3).max(30).required(),
  measurement: Joi.string().alphanum().min(3).max(30).required(),
  field: Joi.string().regex(/^\w+$/).required(),
  //devEui: Joi.string().regex(/^[0-9A-Fa-f-]{10,36}$/).required(), // a modifié si erreur de fetch coté frontend
  //devEui: Joi.string().alphanum().min(3).max(30).required(),
  devEui: Joi.string().required(),
  start: Joi.string().default('-1h'),
  stop: Joi.string().default('now()'),
});
const tableSchema = Joi.object({
  bucketName: Joi.string().pattern(/^[a-zA-Z0-9_]+$/).min(3).max(30).required(),
  measurement: Joi.string().alphanum().min(3).max(30).required(),
  start: Joi.string().default('-10h'),
});
const notifSchema = Joi.object({
  bucketName: Joi.string().pattern(/^[a-zA-Z0-9_]+$/).min(3).max(30).required(),
  measurement: Joi.string().alphanum().min(3).max(30).required(),
  devEui: Joi.string().required(),
  //devEui: Joi.string().regex(/^[0-9A-Fa-f-]{10,36}$/).required(),
});
const trackingSchema = Joi.object({
  bucketName: Joi.string().pattern(/^[a-zA-Z0-9_]+$/).min(3).max(30).required(),
  measurement: Joi.string().alphanum().min(3).max(30).required(),
  //devEui: Joi.string().regex(/^[0-9A-Fa-f-]{10,36}$/).required(),
  devEui: Joi.string().required(),
  start: Joi.string().default('-10h'),
  stop: Joi.string().default('now()'),
});

/* RECUPERE LISTE DEVEUI */
export async function getDevEuiList(req, res, next) {
  const {bucketName, measurement} = req.params;
  const {start, stop} = req.query;
  // console.log(`Received start: ${start}, stop: ${stop}`);

  const validationResult = devListSchema.validate({bucketName, measurement, start, stop});

  if (validationResult.error) {
    const err = new Error('Invalid input parameters');
    err.details = validationResult.error.details;
    return next(err);
  }
  const {start: validatedStart, stop: validatedStop} = validationResult.value;
  console.log(`Using validated start: ${validatedStart}, stop: ${validatedStop}`);

  const query = `
        from(bucket: "${bucketName}")
        |> range(start: ${validatedStart}, stop: ${validatedStop})
        |> filter(fn: (r) => r._measurement == "${measurement}")
        |> keep(columns: ["devEui"])
        |> distinct(column: "devEui")
    `;
  console.log(`Executing query: ${query}`);

  const devEuiList = new Set();
  queryApi.queryRows(query, {
    next(row, tableMeta) {
      const o = tableMeta.toObject(row);
      devEuiList.add(o.devEui);
      //console.log('DevEui found:', o.devEui);
    },
    error(error) {
      //console.error('ERROR', error);
      next(new Error(`Error querying data: ${error.message}`));
    },
    complete() {
      //console.log('DevEui:', Array.from(devEuiList));
      res.json({devEui: Array.from(devEuiList)});
    },
  });
};

/* DONNEES POUR GRAPHES ET GAUGES */
export async function getData(req, res, next) {
  const {bucketName, measurement, field, devEui} = req.params;
  const {start, stop} = req.query;
  // console.log(bucketName, measurement, field, devEui);
  const validationResult = dataSchema.validate({bucketName, measurement, field, start, stop, devEui});

  if (validationResult.error) {
    const err = new Error('Invalid input parameters');
    err.details = validationResult.error.details;
    return next(err);
  }

  try {
    const query = `from(bucket: "${validationResult.value.bucketName}")
                       |> range(start: ${validationResult.value.start}, stop: ${validationResult.value.stop})
                       |> filter(fn: (r) => r._measurement == "${validationResult.value.measurement}")
                       |> filter(fn: (r) => r._field == "${validationResult.value.field}")
                       |> filter(fn: (r) => r.devEui == "${validationResult.value.devEui}")`;

    const results = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push(o);
      },
      error(error) {
        console.error(`ERROR in getData: ${error}`);
        next(new Error(`Error querying data: ${error.message}`));
      },
      complete() {
        const formattedResults = results.map((data) => {
          return {
            device: data.devEui,
            value: data._value,
            timestamp: data._time,
          };
        });
        //console.log(formattedResults);
        res.json(formattedResults);
      },
    });
  } catch (error) {
    console.error('Query error', error);
    next(new Error(`Failed to query data: ${error.message}`));
  }
};

/* DONNEES POUR TABLEAU DASHBOARD */
export async function getTableData(req, res, next) {
  const {bucketName, measurement} = req.params;
  const {start} = req.query;
  console.log(bucketName, measurement, start);
  const validationResult = tableSchema.validate({bucketName, measurement, start});

  if (validationResult.error) {
    const err = new Error('Invalid input parameters');
    err.details = validationResult.error.details;
    return next(err);
  }
  const {start: validatedStart} = validationResult.value;

  const query = `
        from(bucket: "${bucketName}")
        |> range(start: ${validatedStart})
        |> filter(fn: (r) => r._measurement == "${measurement}")
        |> last()
        |> keep(columns: ["devEui", "_field", "_value", "_time"])
    `;

  //console.log('Flux Query:', query);

  try {
    const results = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push(o);
        //console.log('Row Data:', o);
      },
      error(error) {
        console.error('ERROR', error);
        next(new Error(`Error querying data: ${error.message}`));
      },
      complete() {
        const formattedResults = {};
        const fieldMap = {
          latitude: 'lat',
          longitude: 'lng',
          snr: 'snr',
          rssi: 'rssi',
          battery: 'battery',
        };

        results.forEach((data) => {
          const {devEui, _field, _value, _time } = data;
          if (!formattedResults[devEui]) {
            formattedResults[devEui] = {device: devEui, localisation: {}, timestamp: _time};
          }
          if (_field in fieldMap) {
            if (_field === 'latitude' || _field === 'longitude') {
              formattedResults[devEui].localisation[fieldMap[_field]] = _value;
            } else {
              formattedResults[devEui][fieldMap[_field]] = _value;
            }
          }
        });

        const finalResults = Object.values(formattedResults);
        console.log(finalResults);
        res.json(finalResults);
      },
    });
  } catch (error) {
    console.error('Query error', error);
    next(new Error(`Failed to query data: ${error.message}`));
  }
};

/* DONNEES POUR TABLEAU MAP */
export const getMapData = async (req, res, next) => {
  const {bucketName, measurement} = req.params;
  const {start} = req.query;
  // console.log(bucketName, measurement, start);
  const validationResult = tableSchema.validate({bucketName, measurement, start});

  if (validationResult.error) {
    const err = new Error('Invalid input parameters');
    err.details = validationResult.error.details;
    return next(err);
  }
  const {start: validatedStart} = validationResult.value;

  const query = `
        from(bucket: "${bucketName}")
        |> range(start: ${validatedStart})
        |> filter(fn: (r) => r._measurement == "${measurement}")
        |> last()
        |> keep(columns: ["devEui", "_field", "_value"])
    `;

  //console.log('Flux Query:', query);

  try {
    const results = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push(o);
        //console.log('Row Data:', o);
      },
      error(error) {
        console.error('ERROR', error);
        next(new Error(`Error querying data: ${error.message}`));
      },
      complete() {
        const formattedResults = {};
        const fieldMap = {
          latitude: 'lat',
          longitude: 'lng',
          battery: 'battery',
        };

        results.forEach((data) => {
          const {devEui, _field, _value} = data;
          if (!formattedResults[devEui]) {
            formattedResults[devEui] = {device: devEui, localisation: {}};
          }
          if (_field in fieldMap) {
            if (_field === 'latitude' || _field === 'longitude') {
              formattedResults[devEui].localisation[fieldMap[_field]] = parseFloat(_value);
            } else {
              formattedResults[devEui][fieldMap[_field]] = parseFloat(_value);
            }
          }
        });

        const finalResults = Object.values(formattedResults);
        //console.log(finalResults);
        res.json(finalResults);
      },
    });
  } catch (error) {
    console.error('Query error', error);
    next(new Error(`Failed to query data: ${error.message}`));
  }
};

/* DONNES POUR TRACKING ET INFO DEVICE POUR MAP PAGE*/
export const getTrackingData = async (req, res, next) => {
  const {bucketName, measurement, devEui} = req.params;
  const {start, stop} = req.query;
  console.log(bucketName, measurement, devEui, start, stop);
  const validationResult = trackingSchema.validate({bucketName, measurement, devEui, start, stop});

  if (validationResult.error) {
    const err = new Error('Invalid input parameters');
    err.details = validationResult.error.details;
    return next(err);
  }
  const {start: validatedStart, stop: validatedStop} = validationResult.value;

  const query = `
        from(bucket: "${bucketName}")
        |> range(start: ${validatedStart}, stop: ${validatedStop})
        |> filter(fn: (r) => r._measurement == "${measurement}")
        |> filter(fn: (r) => r.devEui == "${devEui}")
        |> keep(columns: ["devEui", "_field", "_value", "_time"])
    `;

  //console.log('Flux Query:', query);

  try {
    const results = [];
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        results.push(o);
        //console.log('Row Data:', o);
      },
      error(error) {
        console.error('ERROR', error);
        next(new Error(`Error querying data: ${error.message}`));
      },
      complete() {
        const locationData = [];
        results.forEach((data) => {
          const {_field, _value, _time} = data;

          let entry = locationData.find((entry) => entry.timestamp === _time);
          if (!entry) {
            entry = {timestamp: _time, localisation: {}, battery: null};
            locationData.push(entry);
          }

          switch (_field) {
            case 'latitude':
              entry.localisation.lat = parseFloat(_value);
              break;
            case 'longitude':
              entry.localisation.lng = parseFloat(_value);
              break;
            case 'battery':
              entry.battery = parseFloat(_value);
              break;
          }
        });

        //console.log(locationData);
        res.json(locationData);
      },
    });
  } catch (error) {
    console.error('Query error', error);
    next(new Error(`Failed to query data: ${error.message}`));
  }
};

/* PERMET DE CONNAITRE LES FIELDS POUR UN DEVEUI DONNE */
export const getNotificationData = async (req, res, next) => {
  const {error, value} = notifSchema.validate(req.params);
  if (error) {
    return next(new Error(`Invalid input parameters: ${error.details.map((d) => d.message).join(', ')}`));
  }

  const {bucketName, measurement, devEui} = value;
  const fieldsToExclude = ['fCnt', 'latitude', 'longitude', 'snr', 'rssi', 'spreadingFactor'];

  const query = `
        from(bucket: "${bucketName}")
        |> range(start: -1h)
        |> filter(fn: (r) => r._measurement == "${measurement}")
        |> filter(fn: (r) => r.devEui == "${devEui}")
        |> keep(columns: ["_field"])
        |> distinct(column: "_field")
    `;

  // console.log('Flux Query:', query);

  const fields = [];
  queryApi.queryRows(query, {
    next(row, tableMeta) {
      const o = tableMeta.toObject(row);
      if (!fields.includes(o._field) && !fieldsToExclude.includes(o._field)) {
        fields.push(o._field);
        console.log('Field found:', o._field);
      }
    },
    error(error) {
      console.error('ERROR', error);
      next(new Error(`Error querying data: ${error.message}`));
    },
    complete() {
      //console.log('Fields:', fields);
      res.json({devEui: devEui, availableFields: fields});
    },
  });
};

/* POST ALERTE*/
export async function postAlert(req, res, next) {
  const {devEui, field, value} = req.body;
  if (!devEui || !field || value === undefined) {
    return next(new Error('Invalid input parameters. Please provide devEui, field, and value.'));
  }

  try {
    const point = new Point('thresholds')
        .tag('devEui', devEui)
        .floatField(field, parseFloat(value))
        .timestamp(new Date());
    await alertWriteApi.writePoint(point);
    await alertWriteApi.flush();
    console.log(`Threshold for ${field} on device ${devEui} set to ${value}`);
    res.status(200).json({message: 'Alert threshold set and check created successfully'});
  } catch (error) {
    console.error('Error:', error);
    next(new Error(`Error setting alert threshold and creating check: ${error.message}`));
  }
}


async function compareAndLog() {
  const queryApi = client.getQueryApi(org);

  const fluxQuery = `
      from(bucket:"${bucket}")
        |> range(start: -5m)
        |> filter(fn: (r) => r._measurement == "deviceData" or r._measurement == "thresholds")
        |> pivot(rowKey:["_time", "devEui", "_field"], columnKey: ["_measurement"], valueColumn: "_value")
        |> filter(fn: (r) => r.deviceData != null and r.thresholds != null)
        |> map(fn: (r) => ({
          devEui: r.devEui,
          field: r._field,
          deviceValue: r.deviceData,
          threshold: r.thresholds,
          exceeds: r.deviceData > r.thresholds
        }))
        |> filter(fn: (r) => r.exceeds == true)
    `;

  try {
    const results = await queryApi.collectRows(fluxQuery);

    if (results.length === 0) {
      console.log('Aucun dépassement de seuil détecté.');
    } else {
      results.forEach((row) => {
        console.log(`ALERTE: La valeur ${row.deviceValue} pour le champ ${row.field} du device ${row.devEui} dépasse le seuil de ${row.threshold}`);
      });
    }
  } catch (error) {
    console.error('Erreur lors de la requête InfluxDB:', error);
  }
}