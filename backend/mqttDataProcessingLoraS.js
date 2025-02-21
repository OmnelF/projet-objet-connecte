/**
 * @file MQTT message processing and data extraction for EchoStar 7
 * @lastModified 10/01/2025
 */
import { Buffer } from "buffer";

const BUFFER_POSITIONS = {
  TEMPERATURE: 0, // 2 bytes
  HUMIDITY: 2, // 1 byte
  PRESSURE: 3, // 2 bytes
  LAT: 5, // 3 bytes
  LON: 8, // 3 bytes
  ALT: 11, // 3 bytes
  SATELLITES: 14, // 1 byte
  BATTERY: 15, // 2 bytes
  TTF: 17, // 1 byte
  SPEED: 18, // 1 byte
  POWER: 19, // 1 byte
  SNR: 20, // 1 byte
  RSSI: 21, // 1 byte
  MIN_BUFFER_LENGTH: 22,
};

function read24BitLocation(buffer, offset, isLatitude) {
  const value =
    (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
  if (isLatitude) {
    return (value * 180) / 16777215 - 90;
  }
  return (value * 360) / 16777215 - 180;
}

function decodePayload(buffer) {
  if (buffer.length < BUFFER_POSITIONS.MIN_BUFFER_LENGTH) {
    throw new Error("Buffer too short");
  }

  return {
    // Environmental data
    temperature: buffer.readInt16BE(BUFFER_POSITIONS.TEMPERATURE) / 100,
    humidity: buffer[BUFFER_POSITIONS.HUMIDITY] / 2,
    pressure: buffer.readUInt16BE(BUFFER_POSITIONS.PRESSURE) * 10,

    // GNSS data
    location: {
      latitude: read24BitLocation(buffer, BUFFER_POSITIONS.LAT, true),
      longitude: read24BitLocation(buffer, BUFFER_POSITIONS.LON, false),
      altitude:
        ((buffer[BUFFER_POSITIONS.ALT] << 16) |
          (buffer[BUFFER_POSITIONS.ALT + 1] << 8) |
          buffer[BUFFER_POSITIONS.ALT + 2]) /
        100,
      satellites: buffer[BUFFER_POSITIONS.SATELLITES],
    },

    // System data
    battery: buffer.readUInt16BE(BUFFER_POSITIONS.BATTERY),
    timeToFix: buffer[BUFFER_POSITIONS.TTF],
    speed: buffer[BUFFER_POSITIONS.SPEED],
    power: buffer[BUFFER_POSITIONS.POWER],

    // Signal quality
    signalQuality: {
      snr: buffer.readInt8(BUFFER_POSITIONS.SNR),
      rssi: -buffer[BUFFER_POSITIONS.RSSI],
    },
  };
}

function processMqttMessage(message) {
  let messageObj;
  try {
    messageObj = JSON.parse(message.toString());
  } catch (e) {
    console.error("Error parsing JSON message:", e);
    return null;
  }

  if (!messageObj.gatewayID) {
    console.error("Gateway ID missing in message");
    return null;
  }

  const processedData = {
    time: messageObj.time,
    devEUI: messageObj.devEUI,
    gatewayId: messageObj.gatewayID,
    rssi: messageObj.rssi,
    snr: messageObj.snr,
    uplinkID: messageObj.uplinkID,
    radio: {
      frequency: messageObj.frequency,
      bandwidth: messageObj.bandwidth,
      modulation: messageObj.modulation,
      spreadingFactor: messageObj.spreadingFactor,
      codeRate: messageObj.codeRate,
      adr: messageObj.adr,
      dr: messageObj.dr,
    },
    frame: {
      fCnt: messageObj.fCnt,
      fPort: messageObj.fPort,
      devAddr: messageObj.devAddr,
      confirmed: messageObj.confirmed,
      ackBit: messageObj.ackBit,
    },
    data: null,
  };

  if (!messageObj.frmPayload) {
    console.log("Message without payload received:", {
      devEUI: processedData.devEUI,
      rssi: processedData.rssi,
      snr: processedData.snr,
      radio: processedData.radio,
    });
    return processedData;
  }

  try {
    const buffer = Buffer.from(messageObj.frmPayload, "base64");
    console.log("Buffer length:", buffer.length);
    console.log("Buffer content:", buffer.toString("hex"));
    processedData.data = decodePayload(buffer);

    console.log("Processed data:", {
      devEUI: processedData.devEUI,
      rssi: processedData.rssi,
      snr: processedData.snr,
      radio: processedData.radio,
      frame: processedData.frame,
      temperature: processedData.data?.temperature,
      humidity: processedData.data?.humidity,
      pressure: processedData.data?.pressure,
      location: processedData.data?.location,
    });

    return processedData;
  } catch (error) {
    console.error("Error processing payload:", error);
    return processedData; 
  }
}
export { processMqttMessage };
