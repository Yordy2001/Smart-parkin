# 🚗 Parqueo Inteligente - Sistema IoT

Sistema de parqueo inteligente con ESP32, sensores IR y cámaras ESP32-CAM para monitoreo en tiempo real.

## 📋 Características

- **10 Sensores IR**: 2 para entrada/salida + 8 para detectar ocupación de espacios
- **5 ESP32-CAM**: Cámaras de seguridad con subida automática de imágenes
- **1 ESP32 Principal**: Controlador central del sistema
- **Dashboard Web**: Interfaz en tiempo real con Express.js y EJS
- **API REST**: Endpoints para recibir datos de los dispositivos IoT

## 🛠️ Instalación

1. **Instalar Node.js** (versión 16 o superior)

2. **Instalar dependencias:**
```bash
npm install
```

3. **Ejecutar el servidor:**
```bash
npm start
```

4. **Para desarrollo (con auto-reload):**
```bash
npm run dev
```

5. **Abrir en el navegador:**
```
http://localhost:3000
```

## 📡 API Endpoints para Dispositivos ESP32

### Sensores IR (Entrada/Salida)
```bash
# Vehículo entra al parqueo
POST /api/gate
Content-Type: application/json
{
  "sensor": "entry",
  "vehicleId": "opcional"
}

# Vehículo sale del parqueo
POST /api/gate
Content-Type: application/json
{
  "sensor": "exit",
  "vehicleId": "opcional"
}
```

### Sensores de Espacios (Ocupación)
```bash
# Actualizar estado de un espacio (1-10)
POST /api/slot/:id
Content-Type: application/json
{
  "occupied": true  // true = ocupado, false = libre
}

# Ejemplo: Espacio 3 ocupado
POST /api/slot/3
{
  "occupied": true
}
```

### ESP32-CAM (Subida de Imágenes)
```bash
# Subir imagen desde cámara (1-5)
POST /api/camera/:camId/upload
Content-Type: multipart/form-data

# Campo del formulario: "image"
# Ejemplo con curl:
curl -X POST http://localhost:3000/api/camera/1/upload -F "image=@foto.jpg"
```

### Consultar Estado
```bash
# Obtener estado completo del parqueo
GET /api/status

# Obtener última imagen de una cámara
GET /api/camera/:camId/latest
```

## 🖥️ Páginas Web

- **Dashboard Principal**: `/` - Vista general con estadísticas y eventos
- **Espacios de Parqueo**: `/parqueos` - Estado detallado de todos los espacios
- **Cámaras de Seguridad**: `/camaras` - Imágenes de todas las ESP32-CAM

## 📁 Estructura del Proyecto

```
parqueo-inteligente/
├── package.json          # Dependencias y scripts
├── server.js             # Servidor Express principal
├── views/                # Plantillas EJS
│   ├── dashboard.ejs     # Dashboard principal
│   ├── parqueos.ejs      # Vista de espacios
│   └── camaras.ejs       # Vista de cámaras
├── public/               # Archivos estáticos
│   └── styles.css        # Estilos CSS
├── uploads/              # Imágenes de cámaras (auto-creado)
│   ├── cam-1/           # Imágenes de cámara 1
│   ├── cam-2/           # Imágenes de cámara 2
│   └── ...
└── README.md            # Este archivo
```

## 🔧 Configuración para ESP32

### Código ejemplo para ESP32 (Sensor IR):
```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "TU_WIFI";
const char* password = "TU_PASSWORD";
const char* serverURL = "http://192.168.1.100:3000"; // IP de tu servidor

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Conectando a WiFi...");
  }
  Serial.println("WiFi conectado!");
}

void sendGateEvent(String sensor) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(serverURL) + "/api/gate");
    http.addHeader("Content-Type", "application/json");
    
    StaticJsonDocument<200> doc;
    doc["sensor"] = sensor;
    
    String jsonString;
    serializeJson(doc, jsonString);
    
    int httpResponseCode = http.POST(jsonString);
    if (httpResponseCode > 0) {
      Serial.println("Evento enviado: " + sensor);
    }
    http.end();
  }
}

void sendSlotUpdate(int slotId, bool occupied) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(serverURL) + "/api/slot/" + String(slotId));
    http.addHeader("Content-Type", "application/json");
    
    StaticJsonDocument<200> doc;
    doc["occupied"] = occupied;
    
    String jsonString;
    serializeJson(doc, jsonString);
    
    int httpResponseCode = http.POST(jsonString);
    if (httpResponseCode > 0) {
      Serial.println("Slot " + String(slotId) + " actualizado");
    }
    http.end();
  }
}
```

### Código ejemplo para ESP32-CAM:
```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"

const char* ssid = "TU_WIFI";
const char* password = "TU_PASSWORD";
const char* serverURL = "http://192.168.1.100:3000"; // IP de tu servidor
const int camId = 1; // ID de esta cámara (1-5)

void sendPhoto() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Error capturando imagen");
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(serverURL) + "/api/camera/" + String(camId) + "/upload");
    
    String boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    
    String body = "--" + boundary + "\r\n";
    body += "Content-Disposition: form-data; name=\"image\"; filename=\"cam" + String(camId) + ".jpg\"\r\n";
    body += "Content-Type: image/jpeg\r\n\r\n";
    
    String footer = "\r\n--" + boundary + "--\r\n";
    
    int httpResponseCode = http.POST(body + String((char*)fb->buf, fb->len) + footer);
    
    if (httpResponseCode > 0) {
      Serial.println("Imagen enviada exitosamente");
    }
    
    http.end();
  }
  
  esp_camera_fb_return(fb);
}
```

## 🚀 Características del Sistema

- ✅ **Tiempo Real**: Actualización automática cada 3-5 segundos
- ✅ **Responsive**: Funciona en móviles y tablets
- ✅ **Historial**: Log de eventos y múltiples imágenes por cámara
- ✅ **API REST**: Fácil integración con dispositivos IoT
- ✅ **Gestión de Archivos**: Limpieza automática de imágenes antiguas
- ✅ **Interfaz Moderna**: Dashboard intuitivo con estadísticas visuales

## 📞 Soporte

Para problemas o dudas sobre la implementación, revisa los logs del servidor y verifica la conectividad de los dispositivos ESP32.
