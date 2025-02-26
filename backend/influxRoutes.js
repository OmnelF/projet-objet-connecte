import express from 'express';
import verifyToken from '../utils/verifyToken.js';
import {
    postAlert, 
    getTrackingData, 
    getDevEuiList, 
    getData,
    getTableData, 
    getMapData, 
    getNotificationData 
 } from '../controllers/influxController.js';
 
const router = express.Router();

router.use(verifyToken);

router.get('/device-list/:bucketName/:measurement', getDevEuiList);

router.get('/data/:bucketName/:measurement/:devEui/:field', getData);

router.get('/table-data/:bucketName/:measurement', getTableData);

router.get('/map-data/:bucketName/:measurement', getMapData);

router.get('/map-track/:bucketName/:measurement/:devEui', getTrackingData);

router.get('/notification-data/:bucketName/:measurement/:devEui', getNotificationData);

router.post('/set-alert',postAlert);

export default router;