#include <WiFi.h>
#include <HTTPClient.h>

// Configuración WiFi
const char* ssid = "PARQUEO-32";
const char* password = "Esp32cam";

// Configuración del servidor
const char* serverURL = "http://192.168.88.5:3000";

// Pines de los sensores IR para slots 1-4
const int irPins[4] = {34, 35, 32, 33};  // Pines GPIO para slots 1, 2, 3, 4
const int numSlots = 4;

// Variables de estado para cada slot
bool lastStates[4] = {false, false, false, false};
unsigned long lastSendTimes[4] = {0, 0, 0, 0};
int stableCounts[4] = {0, 0, 0, 0};

// Configuración de timing
const unsigned long sendInterval = 2000;    // 2 segundos entre envíos
const unsigned long debounceDelay = 300;    // 300ms de debounce
const int requiredStable = 3;               // 3 lecturas estables

void setup() {
  Serial.begin(115200);
  
  // Configurar pines como entrada
  for (int i = 0; i < numSlots; i++) {
    pinMode(irPins[i], INPUT);
  }

  // Conectar WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  
  Serial.println("WiFi conectado");
  Serial.println("IP: " + WiFi.localIP().toString());
  
  // Leer estados iniciales
  delay(500);
  for (int i = 0; i < numSlots; i++) {
    bool initialState = digitalRead(irPins[i]) == HIGH;
    lastStates[i] = initialState;
    
    // Enviar estado inicial de cada slot
    sendUpdate(i + 1, initialState);
    delay(200);  // Pequeña pausa entre envíos
  }
  
  Serial.println("Sistema iniciado - Monitoreando slots 1-4");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Revisar cada sensor
  for (int i = 0; i < numSlots; i++) {
    bool currentState = digitalRead(irPins[i]) == HIGH;
    int slotId = i + 1;
    
    // Verificar estabilidad de la lectura
    if (currentState == lastStates[i]) {
      stableCounts[i]++;
    } else {
      stableCounts[i] = 0;
    }
    
    // Si hay cambio y ha pasado suficiente tiempo
    if (stableCounts[i] == 0 && 
        currentTime - lastSendTimes[i] > sendInterval) {
      
      // Esperar debounce
      delay(debounceDelay);
      
      // Verificar nuevamente después del debounce
      bool confirmedState = digitalRead(irPins[i]) == HIGH;
      
      if (confirmedState != lastStates[i]) {
        if (sendUpdate(slotId, confirmedState)) {
          lastStates[i] = confirmedState;
          lastSendTimes[i] = currentTime;
        }
      }
    }
  }
  
  delay(100);
}

bool sendUpdate(int slot, bool occupied) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  String endpoint = String(serverURL) + "/api/slot/" + String(slot);
  
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);
  
  String payload = "{\"occupied\":" + String(occupied ? "true" : "false") + "}";
  
  int responseCode = http.POST(payload);
  bool success = (responseCode >= 200 && responseCode < 300);
  
  if (success) {
    Serial.println("Slot " + String(slot) + ": " + (occupied ? "OCUPADO" : "LIBRE"));
  }
  
  http.end();
  return success;
}


