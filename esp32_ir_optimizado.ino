#include <WiFi.h>
#include <HTTPClient.h>

// Configuración WiFi
const char* ssid = "PARQUEO-32";
const char* password = "Esp32cam";

// Configuración del servidor
const char* serverURL = "http://192.168.88.5:3000";
const int slotId = 1;  // Cambiar por el ID del espacio (1-10)

// Pin del sensor IR
const int irPin = 34;

// Variables de estado
bool lastOccupiedState = false;
unsigned long lastSendTime = 0;
const unsigned long sendInterval = 2000;  // 2 segundos entre envíos
const unsigned long debounceDelay = 300;   // 300ms de debounce

// Variables para lecturas estables
int stableCount = 0;
const int requiredStable = 3;  // 3 lecturas iguales consecutivas

void setup() {
  Serial.begin(115200);
  pinMode(irPin, INPUT);

  // Conectar WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  
  Serial.println("WiFi conectado");
  Serial.println("IP: " + WiFi.localIP().toString());
  
  // Estado inicial
  delay(500);
  bool initialState = digitalRead(irPin) == HIGH;
  lastOccupiedState = initialState;
  
  // Enviar estado inicial
  sendUpdate(initialState);
  
  Serial.println("Sistema iniciado - Espacio " + String(slotId));
}

void loop() {
  bool currentState = digitalRead(irPin) == HIGH;
  
  // Verificar estabilidad de la lectura
  if (currentState == lastOccupiedState) {
    stableCount++;
  } else {
    stableCount = 0;
  }
  
  // Si la lectura es diferente y estable, enviar actualización
  if (stableCount == 0 && 
      millis() - lastSendTime > sendInterval) {
    
    // Esperar a que se estabilice
    delay(debounceDelay);
    
    // Verificar nuevamente después del debounce
    bool confirmedState = digitalRead(irPin) == HIGH;
    
    if (confirmedState != lastOccupiedState) {
      if (sendUpdate(confirmedState)) {
        lastOccupiedState = confirmedState;
        lastSendTime = millis();
      }
    }
  }
  
  delay(100);
}

bool sendUpdate(bool occupied) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  String endpoint = String(serverURL) + "/api/slot/" + String(slotId);
  
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);
  
  String payload = "{\"occupied\":" + String(occupied ? "true" : "false") + "}";
  
  int responseCode = http.POST(payload);
  bool success = (responseCode >= 200 && responseCode < 300);
  
  if (success) {
    Serial.println("Espacio " + String(slotId) + ": " + (occupied ? "OCUPADO" : "LIBRE"));
  }
  
  http.end();
  return success;
}
