const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SLOTS_COUNT = 10; // 10 espacios de parqueo
const CAMERAS_COUNT = 5; // 5 ESP32-CAM
const MAX_IMAGES_PER_CAM = 20; // Máximo de imágenes por cámara

const app = express();

// Configuración de EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Crear directorio de uploads si no existe
const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};
ensureDir(path.join(__dirname, 'uploads'));

// Estado global del parqueo
const parkingState = {
    // Contadores de entrada y salida
    entryCount: 0,
    exitCount: 0,
    
    // Estado de los 10 espacios de parqueo
    slots: Array.from({ length: SLOTS_COUNT }, (_, i) => ({
        id: i + 1,
        occupied: false,
        updatedAt: null
    })),
    
    // Imágenes de las 5 cámaras
    cameras: {},
    
    // Log de eventos
    events: []
};

// Configuración de multer para subida de imágenes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const camId = req.params.camId;
        const dir = path.join(__dirname, 'uploads', `cam-${camId}`);
        ensureDir(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${timestamp}${ext}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen'));
        }
    }
});

// Función para limpiar imágenes antiguas
function cleanupOldImages(camId) {
    const images = parkingState.cameras[camId] || [];
    if (images.length > MAX_IMAGES_PER_CAM) {
        const toDelete = images.splice(0, images.length - MAX_IMAGES_PER_CAM);
        toDelete.forEach(img => {
            const filePath = path.join(__dirname, 'uploads', `cam-${camId}`, img.filename);
            fs.unlink(filePath, () => {}); // Eliminar archivo sin bloquear
        });
    }
}

// Función para agregar evento al log
function addEvent(type, data) {
    parkingState.events.unshift({
        id: Date.now(),
        type,
        data,
        timestamp: new Date().toISOString()
    });
    
    // Mantener solo los últimos 100 eventos
    if (parkingState.events.length > 100) {
        parkingState.events = parkingState.events.slice(0, 100);
    }
}

// RUTAS WEB

// Página principal - Dashboard
app.get('/', (req, res) => {
    const occupiedSlots = parkingState.slots.filter(s => s.occupied).length;
    const availableSlots = SLOTS_COUNT - occupiedSlots;
    const vehiclesInside = parkingState.entryCount - parkingState.exitCount;
    
    const cameraIds = Object.keys(parkingState.cameras).sort((a, b) => parseInt(a) - parseInt(b));
    
    res.render('dashboard', {
        parkingState,
        occupiedSlots,
        availableSlots,
        vehiclesInside,
        cameraIds,
        totalSlots: SLOTS_COUNT
    });
});

// Página de parqueos disponibles (actualizada dinámicamente)
app.get('/parqueos', (req, res) => {
    res.render('parqueos', {
        slots: parkingState.slots,
        totalSlots: SLOTS_COUNT
    });
});

// Página de cámaras de seguridad
app.get('/camaras', (req, res) => {
    const cameraIds = Object.keys(parkingState.cameras).sort((a, b) => parseInt(a) - parseInt(b));
    res.render('camaras', {
        cameras: parkingState.cameras,
        cameraIds
    });
});

// RUTAS API

// Obtener estado completo del parqueo
app.get('/api/status', (req, res) => {
    const occupiedSlots = parkingState.slots.filter(s => s.occupied).length;
    const availableSlots = SLOTS_COUNT - occupiedSlots;
    const vehiclesInside = parkingState.entryCount - parkingState.exitCount;
    
    res.json({
        entryCount: parkingState.entryCount,
        exitCount: parkingState.exitCount,
        vehiclesInside,
        occupiedSlots,
        availableSlots,
        totalSlots: SLOTS_COUNT,
        slots: parkingState.slots,
        lastEvents: parkingState.events.slice(0, 10)
    });
});

// Endpoint para sensores IR de entrada/salida
app.post('/api/gate', (req, res) => {
    const { sensor, vehicleId } = req.body;
    
    if (sensor === 'entry') {
        parkingState.entryCount++;
        addEvent('ENTRY', { vehicleId, count: parkingState.entryCount });
        console.log(`🚗 Vehículo entró al parqueo. Total entradas: ${parkingState.entryCount}`);
    } else if (sensor === 'exit') {
        parkingState.exitCount++;
        addEvent('EXIT', { vehicleId, count: parkingState.exitCount });
        console.log(`🚗 Vehículo salió del parqueo. Total salidas: ${parkingState.exitCount}`);
    } else {
        return res.status(400).json({ 
            error: 'El campo sensor debe ser "entry" o "exit"' 
        });
    }
    
    const vehiclesInside = parkingState.entryCount - parkingState.exitCount;
    
    res.json({
        success: true,
        entryCount: parkingState.entryCount,
        exitCount: parkingState.exitCount,
        vehiclesInside
    });
});

// Endpoint para actualizar estado de espacios de parqueo
app.post('/api/slot/:id', (req, res) => {
    const slotId = parseInt(req.params.id);
    const { occupied } = req.body;
    
    if (slotId < 1 || slotId > SLOTS_COUNT) {
        return res.status(400).json({ 
            error: `ID de espacio debe estar entre 1 y ${SLOTS_COUNT}` 
        });
    }
    
    if (typeof occupied !== 'boolean') {
        return res.status(400).json({ 
            error: 'El campo occupied debe ser true o false' 
        });
    }
    
    const slot = parkingState.slots.find(s => s.id === slotId);
    const wasOccupied = slot.occupied;
    
    slot.occupied = occupied;
    slot.updatedAt = new Date().toISOString();
    
    // Solo agregar evento si cambió el estado
    if (wasOccupied !== occupied) {
        addEvent('SLOT_UPDATE', { slotId, occupied, previousState: wasOccupied });
        console.log(`🅿️ Espacio ${slotId} ${occupied ? 'ocupado' : 'liberado'}`);
    }
    
    res.json({
        success: true,
        slot: {
            id: slotId,
            occupied,
            updatedAt: slot.updatedAt
        }
    });
});

// Endpoint para recibir imágenes de ESP32-CAM
app.post('/api/camera/:camId/upload', upload.single('image'), (req, res) => {
    const camId = req.params.camId;
    
    if (!req.file) {
        return res.status(400).json({ 
            error: 'No se recibió ninguna imagen. Use el campo "image"' 
        });
    }
    
    const imageInfo = {
        filename: req.file.filename,
        originalname: req.file.originalname,
        size: req.file.size,
        url: `/uploads/cam-${camId}/${req.file.filename}`,
        timestamp: new Date().toISOString()
    };
    
    // Inicializar array de imágenes para esta cámara si no existe
    if (!parkingState.cameras[camId]) {
        parkingState.cameras[camId] = [];
    }
    
    // Agregar nueva imagen
    parkingState.cameras[camId].push(imageInfo);
    
    // Limpiar imágenes antiguas
    cleanupOldImages(camId);
    
    addEvent('CAMERA_IMAGE', { camId, filename: req.file.filename });
    console.log(`📸 Nueva imagen de cámara ${camId}: ${req.file.filename}`);
    
    res.json({
        success: true,
        camera: camId,
        image: imageInfo,
        totalImages: parkingState.cameras[camId].length
    });
});

// Endpoint para obtener última imagen de una cámara
app.get('/api/camera/:camId/latest', (req, res) => {
    const camId = req.params.camId;
    const images = parkingState.cameras[camId];
    
    if (!images || images.length === 0) {
        return res.status(404).json({ 
            error: `No hay imágenes para la cámara ${camId}` 
        });
    }
    
    const latestImage = images[images.length - 1];
    res.json({
        success: true,
        camera: camId,
        image: latestImage
    });
});

// Manejo de errores de multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                error: 'El archivo es demasiado grande (máximo 5MB)' 
            });
        }
    }
    
    res.status(500).json({ 
        error: error.message || 'Error interno del servidor' 
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Parqueo Inteligente ejecutándose en http://localhost:${PORT}`);
    console.log(`📊 Configuración:`);
    console.log(`   - Espacios de parqueo: ${SLOTS_COUNT}`);
    console.log(`   - Cámaras ESP32-CAM: ${CAMERAS_COUNT}`);
    console.log(`   - Puerto: ${PORT}`);
    console.log(`\n📡 Endpoints disponibles:`);
    console.log(`   POST /api/gate - Entrada/salida de vehículos`);
    console.log(`   POST /api/slot/:id - Estado de espacios`);
    console.log(`   POST /api/camera/:camId/upload - Subir imágenes`);
    console.log(`   GET /api/status - Estado completo del parqueo`);
});
