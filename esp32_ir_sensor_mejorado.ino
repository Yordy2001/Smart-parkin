#include <WiFi.h>
#include <HTTPClient.h>

// Configuración WiFi
const char* ssid = "PARQUEO-32";
const char* password = "Esp32cam";

// Configuración del servidor Node.js
const char* serverURL = "http://192.168.88.5:3000";  // Cambia esta IP por la IP de tu servidor Node.js
const int slotId = 1;  // ID del espacio de parqueo (1-10)

// Pin del sensor IR
int irPin = 34;

// Variables de estado mejoradas
int lastIrState = -1;
bool lastOccupiedState = false;
unsigned long lastSendTime = 0;
const unsigned long sendInterval = 2000;  // Reducido a 2 segundos
const unsigned long debounceDelay = 300;  // Reducido para mayor responsividad
unsigned long lastDebounceTime = 0;

// Variables para detección mejorada
int stableReadings = 0;
const int requiredStableReadings = 5;  // Necesita 5 lecturas consecutivas iguales
unsigned long lastReadingTime = 0;
const unsigned long readingInterval = 100;  // Leer cada 100ms

// Diagnóstico
unsigned long lastDiagnosticTime = 0;
const unsigned long diagnosticInterval = 10000;  // Diagnóstico cada 10 segundos

void setup() {
  Serial.begin(115200);
  pinMode(irPin, INPUT);

  Serial.println("\n🚀 === SISTEMA DE PARQUEO INTELIGENTE ===");
  Serial.println("📍 Sensor IR para espacio: " + String(slotId));
  
  // Conectar a WiFi
  WiFi.begin(ssid, password);
  Serial.print("🔗 Conectando a WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("✅ Conectado a WiFi");
  Serial.print("📡 IP del ESP32: ");
  Serial.println(WiFi.localIP());
  Serial.print("🌐 Gateway: ");
  Serial.println(WiFi.gatewayIP());
  
  // DIAGNÓSTICO DE CONECTIVIDAD
  Serial.println("\n🔍 DIAGNÓSTICO DE CONECTIVIDAD:");
  Serial.println("📍 Servidor configurado: " + String(serverURL));
  
  // Probar conectividad básica
  testServerConnection();
  
  // Estado inicial del sensor
  delay(1000);
  int initialState = digitalRead(irPin);
  lastIrState = initialState;
  lastOccupiedState = (initialState == HIGH);
  
  Serial.println("\n🔍 ESTADO INICIAL:");
  Serial.println("📊 Lectura del sensor: " + String(initialState) + " (" + (initialState == HIGH ? "OBJETO DETECTADO" : "SIN OBJETO") + ")");
  Serial.println("🅿️ Estado del espacio: " + String(lastOccupiedState ? "OCUPADO" : "LIBRE"));
  
  // Enviar estado inicial
  Serial.println("\n📤 Enviando estado inicial al servidor...");
  if (sendSlotUpdate(slotId, lastOccupiedState, true)) {
    Serial.println("✅ Estado inicial enviado correctamente");
  } else {
    Serial.println("❌ Error enviando estado inicial");
  }
  
  Serial.println("\n🔄 Iniciando monitoreo continuo...");
  Serial.println("==========================================\n");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Leer sensor cada 100ms
  if (currentTime - lastReadingTime >= readingInterval) {
    lastReadingTime = currentTime;
    
    int currentIrState = digitalRead(irPin);
    
    // Verificar si la lectura es estable
    if (currentIrState == lastIrState) {
      stableReadings++;
    } else {
      stableReadings = 0;
      lastIrState = currentIrState;
      lastDebounceTime = currentTime;
      
      Serial.println("🔄 Cambio detectado en sensor: " + String(currentIrState) + 
                    " (" + (currentIrState == HIGH ? "OBJETO DETECTADO" : "SIN OBJETO") + ")");
    }
    
    // Si tenemos suficientes lecturas estables, procesar el cambio
    if (stableReadings >= requiredStableReadings && 
        (currentTime - lastDebounceTime) > debounceDelay) {
      
      bool currentOccupied = (currentIrState == HIGH);
      bool stateChanged = (currentOccupied != lastOccupiedState);
      bool timeElapsed = (currentTime - lastSendTime) > sendInterval;
      
      if (stateChanged && timeElapsed) {
        Serial.println("\n🔄 === CAMBIO DE ESTADO CONFIRMADO ===");
        Serial.println("📊 Sensor IR: " + String(lastOccupiedState ? "HIGH" : "LOW") + " -> " + String(currentIrState == HIGH ? "HIGH" : "LOW"));
        Serial.println("🅿️ Ocupación: " + String(lastOccupiedState ? "OCUPADO" : "LIBRE") + " -> " + String(currentOccupied ? "OCUPADO" : "LIBRE"));
        Serial.println("⏰ Tiempo desde último envío: " + String(currentTime - lastSendTime) + "ms");
        
        Serial.println("\n📤 Enviando actualización al servidor...");
        if (sendSlotUpdate(slotId, currentOccupied, false)) {
          lastOccupiedState = currentOccupied;
          lastSendTime = currentTime;
          Serial.println("✅ Estado actualizado exitosamente en el servidor");
        } else {
          Serial.println("❌ Error enviando actualización - reintentando en el próximo ciclo");
        }
        Serial.println("=====================================\n");
      }
    }
  }
  
  // Diagnóstico periódico
  if (currentTime - lastDiagnosticTime >= diagnosticInterval) {
    lastDiagnosticTime = currentTime;
    printDiagnostic();
  }
  
  delay(50);  // Pequeña pausa para no saturar el procesador
}

void printDiagnostic() {
  Serial.println("\n📋 === DIAGNÓSTICO PERIÓDICO ===");
  Serial.println("⏰ Tiempo activo: " + String(millis() / 1000) + " segundos");
  Serial.println("📡 WiFi estado: " + String(WiFi.status() == WL_CONNECTED ? "CONECTADO" : "DESCONECTADO"));
  Serial.println("📊 Sensor actual: " + String(digitalRead(irPin)) + " (" + (digitalRead(irPin) == HIGH ? "OBJETO" : "SIN OBJETO") + ")");
  Serial.println("🅿️ Estado espacio: " + String(lastOccupiedState ? "OCUPADO" : "LIBRE"));
  Serial.println("🔄 Lecturas estables: " + String(stableReadings) + "/" + String(requiredStableReadings));
  Serial.println("⏱️ Último envío: " + String((millis() - lastSendTime) / 1000) + " segundos atrás");
  Serial.println("==============================\n");
}

void testServerConnection() {
  Serial.println("🧪 Probando conectividad con el servidor...");
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi no conectado");
    return;
  }
  
  HTTPClient http;
  String testUrl = String(serverURL) + "/api/status";  // Endpoint de prueba
  
  Serial.println("🔗 Probando: " + testUrl);
  
  http.begin(testUrl);
  http.setTimeout(10000);  // 10 segundos de timeout
  
  int httpResponseCode = http.GET();
  
  if (httpResponseCode > 0) {
    Serial.println("✅ Servidor responde! Código: " + String(httpResponseCode));
    if (httpResponseCode == 200) {
      String response = http.getString();
      Serial.println("📄 Respuesta OK - Servidor funcionando correctamente");
    }
  } else {
    Serial.println("❌ Error conectando al servidor:");
    Serial.println("   Código: " + String(httpResponseCode));
    Serial.println("   Error: " + http.errorToString(httpResponseCode));
    
    // Sugerencias de solución
    Serial.println("\n🔧 POSIBLES SOLUCIONES:");
    Serial.println("1. Verifica que el servidor Node.js esté corriendo");
    Serial.println("2. Confirma la IP del servidor: " + String(serverURL));
    Serial.println("3. Verifica que ambos dispositivos estén en la misma red WiFi");
    Serial.println("4. Revisa el firewall del servidor");
  }
  
  http.end();
}

bool sendSlotUpdate(int slot, bool occupied, bool forceInitial) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi desconectado");
    return false;
  }

  HTTPClient http;
  String endpoint = String(serverURL) + "/api/slot/" + String(slot);
  
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);  // 10 segundos de timeout
  
  String jsonPayload = "{\"occupied\":" + String(occupied ? "true" : "false") + "}";
  
  Serial.println("📤 === ENVIANDO DATOS ===");
  Serial.println("🔗 URL: " + endpoint);
  Serial.println("📦 Payload: " + jsonPayload);
  if (forceInitial) {
    Serial.println("🔄 Tipo: Envío inicial forzado");
  } else {
    Serial.println("🔄 Tipo: Cambio de estado detectado");
  }
  
  int httpResponseCode = http.POST(jsonPayload);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("📨 Respuesta HTTP " + String(httpResponseCode));
    
    if (httpResponseCode >= 200 && httpResponseCode < 300) {
      Serial.println("✅ Datos enviados exitosamente");
      Serial.println("📄 Respuesta del servidor: " + response);
      http.end();
      return true;
    } else {
      Serial.println("⚠️ Servidor respondió con error:");
      Serial.println("📄 " + response);
    }
  } else {
    Serial.println("❌ Error HTTP: " + String(httpResponseCode));
    Serial.println("🔧 Detalle: " + http.errorToString(httpResponseCode));
    
    // Diagnóstico adicional para connection refused
    if (httpResponseCode == -1) {
      Serial.println("\n🚨 CONNECTION REFUSED - Posibles causas:");
      Serial.println("1. Servidor Node.js no está corriendo");
      Serial.println("2. IP incorrecta: " + String(serverURL));
      Serial.println("3. Puerto 3000 bloqueado por firewall");
      Serial.println("4. Dispositivos en redes WiFi diferentes");
      Serial.println("5. Servidor sobrecargado o reiniciándose");
    }
  }
  
  Serial.println("========================\n");
  http.end();
  return false;
}
