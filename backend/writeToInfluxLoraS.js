import { getWriteApiForTenant } from "./influxClient.js";
import { Point } from "@influxdata/influxdb-client";

async function writeToInfluxDB(processedData) {
  try {
    const bucket = "GSR";

    const point = new Point("deviceData")
      .timestamp(new Date()) 
      .tag("devEui", processedData.devEUI)
      .tag("gatewayId", processedData.gatewayId)
      .tag("codeRate", processedData.radio.codeRate)
      .tag("devAddr", processedData.frame.devAddr)
      // Radio fields
      .floatField("rssi", processedData.rssi)
      .floatField("snr", processedData.snr)
      .floatField("frequency", processedData.radio.frequency)
      .floatField("bandwidth", processedData.radio.bandwidth)
      .intField("spreadingFactor", processedData.radio.spreadingFactor)
      .booleanField("adr", processedData.radio.adr)
      .intField("dr", processedData.radio.dr)
      // Frame fields
      .intField("fCnt", processedData.frame.fCnt)
      .intField("fPort", processedData.frame.fPort)
      .booleanField("confirmed", processedData.frame.confirmed)
      .booleanField("ackBit", processedData.frame.ackBit);

    if (processedData.data) {
      point
        .floatField("temperature", processedData.data.temperature)
        .floatField("humidity", processedData.data.humidity)
        .floatField("pressure", processedData.data.pressure);
      if (processedData.data.location) {
        point
          .floatField("latitude", processedData.data.location.latitude)
          .floatField("longitude", processedData.data.location.longitude)
          .floatField("altitude", processedData.data.location.altitude)
          .intField("satellites", processedData.data.location.satellites);
      }

      point
        .intField("battery", processedData.data.battery)
        .intField("timeToFix", processedData.data.timeToFix)
        .intField("speed", processedData.data.speed)
        .intField("power", processedData.data.power);

      if (processedData.data.signalQuality) {
        point
          .floatField("payloadSnr", processedData.data.signalQuality.snr)
          .floatField("payloadRssi", processedData.data.signalQuality.rssi);
      }
    }

    const writeApi = getWriteApiForTenant(bucket);
    await writeApi.writePoint(point);
    await writeApi.flush();
  } catch (error) {
    console.error("Erreur écriture InfluxDB:", error);
    throw error;
  }
}

export { writeToInfluxDB };
