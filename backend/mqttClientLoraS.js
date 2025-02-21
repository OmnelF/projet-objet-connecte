/**
 * @file MQTT client configuration and message handling for EchoStar 7
 * @author Ternwaves
 * @lastModified 10/01/2024
 */

import mqtt from "mqtt";
import { processMqttMessage } from "./mqttDataProcessingLoraS.js";
import { writeToInfluxDB } from "../writeToInfluxLoraS.js";
import { broadcastToClients } from "../websocketServer.js";
import dotenv from "dotenv";

dotenv.config();

const mqttConfig = {
  host: "mqtt://unica.ovh:1883",
  username: "team_8",
  password: "MYvCwFtNeVPPtyYlrTsR",
  topic: "cma/echo/1179c1/uplink",
  keepalive: 60,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
};

export const startMqttClient = () => {
  if (!mqttConfig.host) {
    throw new Error("MQTT_ADDRESS not defined in environment variables");
  }

  const client = mqtt.connect(`${mqttConfig.host}`, mqttConfig);
  let reconnectCount = 0;

  client.on("connect", () => {
    console.log(`MQTT Client connected to ${mqttConfig.host}`);
    reconnectCount = 0;

    client.subscribe(mqttConfig.topic, (err) => {
      if (err) {
        console.error("Subscription error:", err);
        return;
      }
      console.log(`Subscribed to topic ${mqttConfig.topic}`);
    });
  });

  client.on("message", async (topic, message) => {
    try {
      if (!message) {
        throw new Error("Empty MQTT message");
      }

      const processedData = processMqttMessage(message);
      if (!processedData) {
        throw new Error("Message processing failed");
      }

      const { devEUI, time, gatewayId } = processedData;

      if (!devEUI) {
        throw new Error("DevEUI missing");
      }

      const timestamp = time || new Date().toISOString();
      processedData.time = timestamp;


      await writeToInfluxDB(processedData);
      await broadcastToClients(processedData);
    } catch (error) {
      console.error("Processing error:", {
        error: error.message,
        topic,
        messageLength: message?.length,
      });
    }
  });

  client.on("error", (error) => {
    console.error("MQTT error :", error);
  });

  client.on("offline", () => {
    console.log("MQTT Client offline");
  });
  return client;
};
