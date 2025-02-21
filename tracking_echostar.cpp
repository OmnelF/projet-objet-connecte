/**
   * @brief This code enables tracking and environmental data collection using the Quectel LC29H GNSS module and the BME280 sensor.
  * It transmits the acquired GNSS position and sensor data via the EchoStar EM module using the LoRaWAN (LR-FHSS) protocol.
  *
  * @author mtnguyen, fferrero, omar
  * @version 1.0.6 for Echo 7 board version
  * 
  */

#define ADC_AREF 3.3f
#define BATVOLT_R1 1.0f
#define BATVOLT_R2 1.0f
#define SLEEP 1

// max. 250 seconds for GPS fix
#define FIXTIME 120
// Period to send data
#define PERIOD 20
// Period Sleep duration
#define SLEEP_DURATION_S 15

#include <Wire.h>
#include <Adafruit_Sensor.h>  // https://github.com/adafruit/Adafruit_BME280_Library
#include <Adafruit_BME280.h>  // https://github.com/adafruit/Adafruit_Sensor
#include <MicroNMEA.h>        // https://github.com/stevemarple/MicroNMEA
#include "STM32LowPower.h"
#include <STM32RTC.h>
#include <Adafruit_Sensor.h>

Adafruit_BME280 bme;
#define SEALEVELPRESSURE_HPA (1013.25)
char nmeaBuffer[100];
MicroNMEA nmea(nmeaBuffer, sizeof(nmeaBuffer));
String revString;
char revChar[1000];
int len = 0;
uint8_t is_fixing = 0;
int ttf = 0;
int lowpower = 0;
int NMEA = 0;
int Sleeptime = 10000;

bool gnss_fix_status = false;

uint32_t start_timestamp = 0;
uint32_t stop_timestamp = 0;
uint8_t mode = 0;
bool joined = false;
long currentMillis = 0, getSensorDataPrevMillis = 0;
boolean lora_sending = true;

struct DLresults {
  int8_t SNR, RSSI, freq_error;
};


uint32_t led_blink_timestamp = 0;
STM32RTC& rtc = STM32RTC::getInstance();
static uint32_t atime = 600;

void setup() {
  gnss_fix_status = false;

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

#if defined(ECHOSTAR_PWR_ENABLE_PIN)
  pinMode(ECHOSTAR_PWR_ENABLE_PIN, OUTPUT);
  digitalWrite(ECHOSTAR_PWR_ENABLE_PIN, HIGH);
#endif

  // Initialisation GNSS
  pinMode(GNSS_PWR_ENABLE_PIN, OUTPUT);
  digitalWrite(GNSS_PWR_ENABLE_PIN, LOW);
  pinMode(GNSS_V_BCKP_PIN, OUTPUT);
  digitalWrite(GNSS_V_BCKP_PIN, LOW);
  delay(100);

  // Initialisation USB Serial
  USB_SERIAL.begin(115200);
  while (!USB_SERIAL)
    ;
  USB_SERIAL.println("Starting...");

  // Configuration du GNSS
  GNSS_SERIAL.begin(115200);  // UART GNSS
  delay(5000);                // Attendre que le GNSS démarre
  digitalWrite(GNSS_PWR_ENABLE_PIN, HIGH);
  digitalWrite(GNSS_V_BCKP_PIN, HIGH);

  // Wait for GNSS fix
  unsigned long start_fix_timestamp = millis();
  USB_SERIAL.println("Waiting for GNSS fix...");

  while (!gnss_fix_status) {
    if (GNSS_SERIAL.available()) {
      char c = GNSS_SERIAL.read();
      nmea.process(c);  

      if (nmea.isValid() && nmea.getNumSatellites() > 4) {
        gnss_fix_status = true;
        unsigned long stop_fix_timestamp = millis();
        USB_SERIAL.println("\nGNSS Module fixed!");
        USB_SERIAL.print("Time-to-first-fix (milliseconds): ");
        USB_SERIAL.println(stop_fix_timestamp - start_fix_timestamp);

        USB_SERIAL.print("Num. satellites: ");
        USB_SERIAL.println(nmea.getNumSatellites());
        USB_SERIAL.print("Latitude: ");
        USB_SERIAL.println(nmea.getLatitude() / 1000000.0, 6);
        USB_SERIAL.print("Longitude: ");
        USB_SERIAL.println(nmea.getLongitude() / 1000000.0, 6);
      }
    }
  }

  // Set pins and interupts
  pinMode(USER_BTN, INPUT_PULLUP);
  pinMode(SENSORS_PWR_ENABLE_PIN, OUTPUT);
  digitalWrite(SENSORS_PWR_ENABLE_PIN, HIGH);
  pinMode(DPDT_CTRL_PIN, OUTPUT);
  digitalWrite(DPDT_CTRL_PIN, LOW);

  pinMode(ECHOSTAR_SWCTRL_PIN, INPUT);

  // I2C Configuration 
  Wire.setSDA(SENSORS_I2C_SDA_PIN);
  Wire.setSCL(SENSORS_I2C_SCL_PIN);
  Wire.begin();
  delay(200);

#if defined(DPDT_PWR_ENABLE_PIN)
  pinMode(DPDT_PWR_ENABLE_PIN, OUTPUT);
  digitalWrite(DPDT_PWR_ENABLE_PIN, HIGH);
#endif

  pinMode(DPDT_CTRL_PIN, OUTPUT);
  digitalWrite(DPDT_CTRL_PIN, HIGH);

  pinMode(ECHOSTAR_BOOT_PIN, OUTPUT);
  digitalWrite(ECHOSTAR_BOOT_PIN, HIGH);

  pinMode(ECHOSTAR_RTS_PIN, OUTPUT);
  digitalWrite(ECHOSTAR_RTS_PIN, HIGH);


  getSensorDataPrevMillis = millis();

  // Configuration EchoStar
  ECHOSTAR_SERIAL.begin(115200);  // UART EM2050

  if ((millis() - getSensorDataPrevMillis) > 5000) {
    lora_sending = true;
  }
  // Configuration BME280
  if (!bme.begin(SENSORS_BME280_ADDRESS)) {
    USB_SERIAL.println(F("Could not find a valid BME280 sensor, check wiring!"));
    while (1)
      ;
  }
  // Set up oversampling and filter initialization
  bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                  Adafruit_BME280::SAMPLING_X16,  // temperature
                  Adafruit_BME280::SAMPLING_X16,  // pressure
                  Adafruit_BME280::SAMPLING_X16,  // humidity
                  Adafruit_BME280::FILTER_OFF);

  // Initial configuration in LoRa S-band mode.
  mode = 1;
  USB_SERIAL.println("Initializing LoRa in S-band mode...");

  ECHOSTAR_SERIAL.println("AT+REGION=MSS-S");
  delay(200);
  USB_SERIAL.println("Set MSS-S mode");

  ECHOSTAR_SERIAL.println("AT+TXPMSS=23");
  delay(200);
  USB_SERIAL.println("Set max TX power");

  ECHOSTAR_SERIAL.println("AT+ADR=1");
  delay(200);
  USB_SERIAL.println("ADR enabled");


  while (ECHOSTAR_SERIAL.available()) {
    ECHOSTAR_SERIAL.read();
  }
  // Join attempt
  USB_SERIAL.println("Starting join procedure...");
  bool joined = false;
  int attempt = 0;
  const int MAX_ATTEMPTS = 5;  

  while (!joined && attempt < MAX_ATTEMPTS) {
    attempt++;
    USB_SERIAL.print("Join attempt ");
    USB_SERIAL.print(attempt);
    USB_SERIAL.print(" of ");
    USB_SERIAL.println(MAX_ATTEMPTS);

    while (ECHOSTAR_SERIAL.available()) {
      ECHOSTAR_SERIAL.read();
    }

    // Send command join
    ECHOSTAR_SERIAL.println("AT+JOIN");
    delay(1000);

    String initialResponse = "";
    while (ECHOSTAR_SERIAL.available()) {
      initialResponse += (char)ECHOSTAR_SERIAL.read();
    }
    USB_SERIAL.println("Réponse initiale: " + initialResponse);

    // Wait for join request to end
    delay(10000);

    // Check attempt of join request
    ECHOSTAR_SERIAL.println("AT+NJS?");
    delay(1000);

    String response = "";
    while (ECHOSTAR_SERIAL.available()) {
      response += (char)ECHOSTAR_SERIAL.read();
    }

    USB_SERIAL.println("Réponse NJS: " + response);

    if (response.indexOf("NJS:1") != -1 || response.indexOf("Successfully joined") != -1) {
      joined = true;
      USB_SERIAL.println("Successfully joined network!");
      break;
    }

    if (!joined && attempt < MAX_ATTEMPTS) {
      USB_SERIAL.println("Join failed, waiting before next attempt...");
      delay(2000);
    }
  }

  if (!joined) {
    USB_SERIAL.println("Failed to join after maximum attempts");
    //NVIC_SystemReset();
  }

  // Low-power library initialization
  rtc.begin();
  led_blink_timestamp = rtc.getEpoch();
  LowPower.begin();
  LowPower.enableWakeupFrom(&rtc, alarmMatch, &atime);

  getSensorDataPrevMillis = millis() - PERIOD * 1000 + 10000;

  delay(600);
  digitalWrite(LED_BUILTIN, LOW);
}

void loop() {
  //Continuous GNSS update
  if (GNSS_SERIAL.available()) {
    char c = GNSS_SERIAL.read();
    nmea.process(c); 
  }
  //Low power mode management
  if (lowpower == 1 && (currentMillis - getSensorDataPrevMillis > 3000)) {
    USB_SERIAL.println("Sleeping");
    delay(200);
    blink(50);

#if SLEEP
    // Put the board to sleep
    EM2050_soft_sleep_enable();
    delay(SLEEP_DURATION_S * 1000);
    USB_SERIAL.println("Sleep completed, waking up EM2050");
    EM2050_soft_sleep_disable();
    getSensorDataPrevMillis = getSensorDataPrevMillis - Sleeptime;  
    delay(20);
#else
    delay(Sleeptime);

#endif
    digitalWrite(ECHOSTAR_BOOT_PIN, HIGH);
    delay(200);
  }

  if (lora_sending == 1) {
    currentMillis = millis();
    if (currentMillis - getSensorDataPrevMillis > PERIOD * 1000) {
      SendLoRa(1);
      lowpower = 1;
      getSensorDataPrevMillis = currentMillis;
    }
  }

  while (ECHOSTAR_SERIAL.available()) {
    Serial.write(ECHOSTAR_SERIAL.read());
  }
}


void alarmMatch(void* data) {
}

void blink(int blinktime) {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(blinktime);
  digitalWrite(LED_BUILTIN, LOW);
}

void gnss(int state) {

  if (state == 1) {
    digitalWrite(GNSS_PWR_ENABLE_PIN, HIGH);
    digitalWrite(GNSS_V_BCKP_PIN, HIGH);
    start_timestamp = millis();
    GNSS_SERIAL.begin(115200);  // UART GNSS
  } else {
    digitalWrite(GNSS_PWR_ENABLE_PIN, LOW);
  }
}
// Send LoRaWan packet with Board sensor values
bool SendLoRa(uint8_t mode) {
  int16_t rx_delay = 0;
  int16_t t = (int16_t)100 * bme.readTemperature();  // return temperature in cents of degree
  uint8_t h = (uint8_t)2 * bme.readHumidity();       // return humidity in percent
  uint16_t p = (uint16_t)(bme.readPressure() / 10);
  long lat = nmea.getLatitude();   //Latitude : 0.0001 ° Signed MSB
  long lon = nmea.getLongitude();  //Longitude : 0.0001 ° Signed MSB
  int8_t speed = (int8_t)(nmea.getSpeed() / 1000);
  int8_t pwr = (int8_t)readpwr();
  float gnss_lat = (float)lat / 1E6;
  float gnss_lon = (float)lon / 1E6;
  long alt;
  nmea.getAltitude(alt);
  int32_t AltitudeBinary = alt / 100;   // Altitude : 0.01 meter Signed MSB
  uint8_t s = nmea.getNumSatellites();  // nb of satellite in view with GNSS
  uint16_t bat = read_bat();
  DLresults dl = readDL();

  uint32_t LatitudeBinary = ((gnss_lat + 90) / 180) * 16777215;
  uint32_t LongitudeBinary = ((gnss_lon + 180) / 360) * 16777215;
  int16_t altitudeGps = alt;

  USB_SERIAL.print("  Temp = ");
  USB_SERIAL.print(t);
  USB_SERIAL.print("  Hum = ");
  USB_SERIAL.print(h);
  USB_SERIAL.print("  Pressure = ");
  USB_SERIAL.print(p);
  USB_SERIAL.print("Lat = ");
  USB_SERIAL.print(gnss_lat, 4);
  USB_SERIAL.print(", Lon = ");
  USB_SERIAL.print(gnss_lon, 4);
  USB_SERIAL.print(", alt = ");
  USB_SERIAL.print(alt / 1e3);
  USB_SERIAL.print(", TTF = ");
  USB_SERIAL.print(ttf);
  USB_SERIAL.print(", Bat = ");
  USB_SERIAL.println(bat);

  int i = 0;
  unsigned char mydata[32];
  mydata[i++] = t >> 8;
  mydata[i++] = t & 0xFF;
  mydata[i++] = h;
  mydata[i++] = p >> 8;
  mydata[i++] = p & 0xFF;
  mydata[i++] = (LatitudeBinary >> 16) & 0xFF;
  mydata[i++] = (LatitudeBinary >> 8) & 0xFF;
  mydata[i++] = LatitudeBinary & 0xFF;
  mydata[i++] = (LongitudeBinary >> 16) & 0xFF;
  mydata[i++] = (LongitudeBinary >> 8) & 0xFF;
  mydata[i++] = LongitudeBinary & 0xFF;
  mydata[i++] = (AltitudeBinary >> 16) & 0xFF;
  mydata[i++] = (AltitudeBinary >> 8) & 0xFF;
  mydata[i++] = AltitudeBinary & 0xFF;
  mydata[i++] = s;
  mydata[i++] = bat >> 8;
  mydata[i++] = bat & 0xFF;
  mydata[i++] = ttf;
  mydata[i++] = speed;
  mydata[i++] = pwr;
  mydata[i++] = (int8_t)dl.SNR / 4;
  mydata[i++] = (int8_t)-dl.RSSI;

  char str[32];
  array_to_string(mydata, i, str);

  ECHOSTAR_SERIAL.print("AT+SENDB=1,0,1,0,");
  ECHOSTAR_SERIAL.println(str);

  return true;
}

void array_to_string(byte array[], unsigned int len, char buffer[]) {
  for (unsigned int i = 0; i < len; i++) {
    byte nib1 = (array[i] >> 4) & 0x0F;
    byte nib2 = (array[i] >> 0) & 0x0F;
    buffer[i * 2 + 0] = nib1 < 0xA ? '0' + nib1 : 'A' + nib1 - 0xA;
    buffer[i * 2 + 1] = nib2 < 0xA ? '0' + nib2 : 'A' + nib2 - 0xA;
  }
  buffer[len * 2] = '\0';
}

uint16_t read_bat(void) {
  uint16_t voltage_adc = (uint16_t)analogRead(SENSORS_BATERY_ADC_PIN);
  uint16_t voltage = (uint16_t)((ADC_AREF / 1.024) * (BATVOLT_R1 + BATVOLT_R2) / BATVOLT_R2 * (float)voltage_adc);
  return voltage;
}

// Read uplink Tx power (usefull when ADR is activated)
int readpwr(void) {
  while (ECHOSTAR_SERIAL.available()) {
    ECHOSTAR_SERIAL.read();
  }
  ECHOSTAR_SERIAL.println("AT+CTP?");
  String temp = ECHOSTAR_SERIAL.readStringUntil('\n');
  temp = ECHOSTAR_SERIAL.readStringUntil(':');
  temp = ECHOSTAR_SERIAL.readStringUntil('\n');
  return temp.toInt();
}
// Read Downlink RSSI from EM2050
DLresults readDL(void) {
  DLresults read;
  while (ECHOSTAR_SERIAL.available()) {
    ECHOSTAR_SERIAL.read();
  }
  ECHOSTAR_SERIAL.println("AT+PKTST?");
  String temp = ECHOSTAR_SERIAL.readStringUntil('\n');
  temp = ECHOSTAR_SERIAL.readStringUntil(':');
  temp = ECHOSTAR_SERIAL.readStringUntil(',');
  read.SNR = temp.toInt();
  temp = ECHOSTAR_SERIAL.readStringUntil(',');
  read.RSSI = temp.toInt();
  temp = ECHOSTAR_SERIAL.readStringUntil('\n');
  read.freq_error = temp.toInt();
  return read;
}

void EM2050_soft_sleep_enable(void) {
  pinMode(ECHOSTAR_RTS_PIN, OUTPUT);
  digitalWrite(ECHOSTAR_RTS_PIN, HIGH);
  delay(50);
}

void EM2050_soft_sleep_disable(void) {
  pinMode(ECHOSTAR_RTS_PIN, INPUT);
  delay(50);
}

void mcu_sleep(uint32_t sleep_duration_s) {
  rtc.setAlarmEpoch(rtc.getEpoch() + sleep_duration_s);
  //LowPower.deepSleep();
}
