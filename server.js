const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const SLOTS_COUNT = 10; // 10 espacios de parqueo
const CAMERAS_COUNT = 5; // 5 ESP32-CAM
const MAX_IMAGES_PER_CAM = 20; // Máximo de imágenes por cámara

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
        updatedAt: null,
        reserved: false,
        reservedBy: null,
        reservedDate: null,
        reservedTime: null
    })),
    
    // Sistema de reservas
    reservations: [],
    
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

// Función para obtener reservas activas para hoy
function getTodayReservations() {
    const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
    console.log(`🔍 DEBUG - Fecha de hoy: ${today}`);
    console.log(`🔍 DEBUG - Reservas totales: ${parkingState.reservations.length}`);
    
    parkingState.reservations.forEach(r => {
        console.log(`🔍 DEBUG - Reserva: ${r.matricula}, Fecha: ${r.fecha}, Status: ${r.status}`);
    });
    
    const todayReservations = parkingState.reservations.filter(r => 
        r.fecha === today && r.status === 'active'
    );
    
    console.log(`🔍 DEBUG - Reservas de hoy encontradas: ${todayReservations.length}`);
    
    return todayReservations;
}

// Página principal - Dashboard
app.get('/', (req, res) => {
    const occupiedSlots = parkingState.slots.filter(s => s.occupied).length;
    const availableSlots = SLOTS_COUNT - occupiedSlots;
    const vehiclesInside = parkingState.entryCount - parkingState.exitCount;
    
    const cameraIds = Object.keys(parkingState.cameras).sort((a, b) => parseInt(a) - parseInt(b));
    
    // Obtener reservas de hoy
    const todayReservations = getTodayReservations();
    
    // Crear un mapa de reservas por slot ID
    const reservationsBySlot = {};
    todayReservations.forEach(reservation => {
        reservationsBySlot[reservation.slotId] = reservation;
    });
    
    res.render('dashboard', {
        parkingState,
        occupiedSlots,
        availableSlots,
        vehiclesInside,
        cameraIds,
        totalSlots: SLOTS_COUNT,
        todayReservations,
        reservationsBySlot
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

// Página de reservas
app.get('/reservas', (req, res) => {
    // Obtener reservas activas (hoy y futuras)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const activeReservations = parkingState.reservations.filter(reservation => {
        const reservationDate = new Date(reservation.fecha);
        return reservationDate >= today && reservation.status === 'active';
    });
    
    // Agrupar reservas por fecha
    const reservationsByDate = {};
    activeReservations.forEach(reservation => {
        const dateKey = reservation.fecha;
        if (!reservationsByDate[dateKey]) {
            reservationsByDate[dateKey] = [];
        }
        reservationsByDate[dateKey].push(reservation);
    });
    
    res.render('reservas', {
        slots: parkingState.slots,
        reservations: activeReservations,
        reservationsByDate,
        totalSlots: SLOTS_COUNT
    });
});

// RUTAS API

// Obtener estado completo del parqueo
app.get('/api/status', (req, res) => {
    // Obtener reservas de hoy para calcular estados correctamente
    const todayReservations = getTodayReservations();
    const reservationsBySlot = {};
    todayReservations.forEach(reservation => {
        reservationsBySlot[reservation.slotId] = reservation;
    });
    
    // Calcular estados considerando reservas
    let occupiedSlots = 0;
    let reservedSlots = 0;
    let availableSlots = 0;
    
    const slotsWithStatus = parkingState.slots.map(slot => {
        const reservation = reservationsBySlot[slot.id];
        let status = 'available';
        let statusIcon = '🟢';
        let statusText = 'Disponible';
        
        if (slot.occupied) {
            status = 'occupied';
            statusIcon = '🚗';
            statusText = 'Ocupado';
            occupiedSlots++;
        } else if (reservation) {
            status = 'reserved';
            statusIcon = '📅';
            statusText = `Reservado por ${reservation.matricula}`;
            reservedSlots++;
        } else {
            availableSlots++;
        }
        
        return {
            ...slot,
            status,
            statusIcon,
            statusText,
            reservation: reservation || null
        };
    });
    
    const vehiclesInside = parkingState.entryCount - parkingState.exitCount;
    
    res.json({
        entryCount: parkingState.entryCount,
        exitCount: parkingState.exitCount,
        vehiclesInside,
        occupiedSlots,
        reservedSlots,
        availableSlots,
        totalSlots: SLOTS_COUNT,
        slots: slotsWithStatus,
        todayReservations,
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
    const clientIP = req.ip || req.connection.remoteAddress;
    const timestamp = new Date().toISOString();
    
    console.log(`\n🔍 [${timestamp}] SOLICITUD RECIBIDA:`);
    console.log(`   📍 Espacio: ${slotId}`);
    console.log(`   📊 Estado solicitado: ${occupied ? 'OCUPADO' : 'LIBRE'}`);
    console.log(occupied);
    console.log(`   🌐 IP Cliente: ${clientIP}`);
    console.log(`   📦 Body completo:`, req.body);
    
    if (slotId < 1 || slotId > SLOTS_COUNT) {
        console.log(`❌ Error: ID de espacio inválido (${slotId})`);
        return res.status(400).json({ 
            error: `ID de espacio debe estar entre 1 y ${SLOTS_COUNT}` 
        });
    }
    
    if (typeof occupied !== 'boolean') {
        console.log(`❌ Error: Tipo de dato inválido para 'occupied' (${typeof occupied}):`, occupied);
        return res.status(400).json({ 
            error: 'El campo occupied debe ser true o false' 
        });
    }
    
    const slot = parkingState.slots.find(s => s.id === slotId);
    const wasOccupied = slot.occupied;
    
    console.log(`📋 Estado anterior: ${wasOccupied ? 'OCUPADO' : 'LIBRE'}`);
    console.log(`📋 Estado nuevo: ${occupied ? 'OCUPADO' : 'LIBRE'}`);
    
    slot.occupied = occupied;
    slot.updatedAt = timestamp;
    
    // Solo agregar evento si cambió el estado
    if (wasOccupied !== occupied) {
        addEvent('SLOT_UPDATE', { slotId, occupied, previousState: wasOccupied });
        console.log(`✅ 🅿️ CAMBIO CONFIRMADO - Espacio ${slotId} ${occupied ? 'ocupado' : 'liberado'}`);
        
        // Emitir evento de Socket.IO para actualización en tiempo real
        io.emit('slotUpdate', {
            slotId,
            occupied,
            wasOccupied,
            timestamp,
            clientIP
        });
        
        // Calcular y emitir estadísticas actualizadas
        const occupiedSlots = parkingState.slots.filter(s => s.occupied).length;
        const availableSlots = SLOTS_COUNT - occupiedSlots;
        
        io.emit('parkingStats', {
            occupiedSlots,
            availableSlots,
            totalSlots: SLOTS_COUNT,
            slots: parkingState.slots
        });
        
    } else {
        console.log(`ℹ️  Sin cambios - Espacio ${slotId} mantiene estado: ${occupied ? 'OCUPADO' : 'LIBRE'}`);
    }
    
    res.json({
        success: true,
        slot: {
            id: slotId,
            occupied,
            wasOccupied,
            updatedAt: slot.updatedAt,
            changed: wasOccupied !== occupied
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

// API para crear reserva
app.post('/api/reservations', (req, res) => {
    const { matricula, fecha, slotId, horaInicio, horaFin } = req.body;
    
    // Validaciones
    if (!matricula || !fecha || !slotId) {
        return res.status(400).json({ 
            error: 'Matrícula, fecha y slot son obligatorios' 
        });
    }
    
    const slotIdNum = parseInt(slotId);
    if (slotIdNum < 1 || slotIdNum > SLOTS_COUNT) {
        return res.status(400).json({ 
            error: `El slot debe estar entre 1 y ${SLOTS_COUNT}` 
        });
    }
    
    // Verificar que la fecha no sea en el pasado
    const reservationDate = new Date(fecha);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (reservationDate < today) {
        return res.status(400).json({ 
            error: 'No se puede reservar en fechas pasadas' 
        });
    }
    
    // Verificar si ya existe una reserva para ese slot en esa fecha
    const existingReservation = parkingState.reservations.find(r => 
        r.slotId === slotIdNum && r.fecha === fecha && r.status === 'active'
    );
    
    if (existingReservation) {
        return res.status(400).json({ 
            error: `El espacio ${slotIdNum} ya está reservado para el ${fecha} por ${existingReservation.matricula}` 
        });
    }
    
    // Crear nueva reserva
    const newReservation = {
        id: Date.now(),
        matricula: matricula.toUpperCase(),
        fecha,
        slotId: slotIdNum,
        horaInicio: horaInicio || '08:00',
        horaFin: horaFin || '18:00',
        createdAt: new Date().toISOString(),
        status: 'active'
    };
    
    parkingState.reservations.push(newReservation);
    
    // Actualizar el slot como reservado
    const slot = parkingState.slots.find(s => s.id === slotIdNum);
    if (slot) {
        slot.reserved = true;
        slot.reservedBy = newReservation.matricula;
        slot.reservedDate = fecha;
        slot.reservedTime = `${horaInicio} - ${horaFin}`;
    }
    
    // Agregar evento
    addEvent('RESERVATION_CREATED', { 
        matricula: newReservation.matricula, 
        slotId: slotIdNum, 
        fecha 
    });
    
    console.log(`📅 Nueva reserva: ${matricula} - Espacio ${slotIdNum} - ${fecha}`);
    
    // Notificar a clientes conectados
    io.emit('newReservation', newReservation);
    
    res.json({
        success: true,
        reservation: newReservation
    });
});

// API para obtener reservas
app.get('/api/reservations', (req, res) => {
    const { date, slotId } = req.query;
    
    let filteredReservations = parkingState.reservations.filter(r => r.status === 'active');
    
    if (date) {
        filteredReservations = filteredReservations.filter(r => r.fecha === date);
    }
    
    if (slotId) {
        filteredReservations = filteredReservations.filter(r => r.slotId === parseInt(slotId));
    }
    
    res.json({
        success: true,
        reservations: filteredReservations
    });
});

// API para cancelar reserva
app.delete('/api/reservations/:id', (req, res) => {
    const reservationId = parseInt(req.params.id);
    const reservationIndex = parkingState.reservations.findIndex(r => r.id === reservationId);
    
    if (reservationIndex === -1) {
        return res.status(404).json({ 
            error: 'Reserva no encontrada' 
        });
    }
    
    const reservation = parkingState.reservations[reservationIndex];
    reservation.status = 'cancelled';
    reservation.cancelledAt = new Date().toISOString();
    
    // Liberar el slot
    const slot = parkingState.slots.find(s => s.id === reservation.slotId);
    if (slot) {
        slot.reserved = false;
        slot.reservedBy = null;
        slot.reservedDate = null;
        slot.reservedTime = null;
    }
    
    addEvent('RESERVATION_CANCELLED', { 
        matricula: reservation.matricula, 
        slotId: reservation.slotId, 
        fecha: reservation.fecha 
    });
    
    console.log(`❌ Reserva cancelada: ${reservation.matricula} - Espacio ${reservation.slotId}`);
    
    // Notificar a clientes conectados
    io.emit('reservationCancelled', reservation);
    
    res.json({
        success: true,
        message: 'Reserva cancelada exitosamente'
    });
});

// API para verificar disponibilidad de slots
app.get('/api/slots/availability', (req, res) => {
    const { date } = req.query;
    
    if (!date) {
        return res.status(400).json({ 
            error: 'Fecha es obligatoria' 
        });
    }
    
    // Obtener reservas para esa fecha
    const reservationsForDate = parkingState.reservations.filter(r => 
        r.fecha === date && r.status === 'active'
    );
    
    // Crear array de disponibilidad
    const availability = Array.from({ length: SLOTS_COUNT }, (_, i) => {
        const slotId = i + 1;
        const reservation = reservationsForDate.find(r => r.slotId === slotId);
        const slot = parkingState.slots.find(s => s.id === slotId);
        
        return {
            slotId,
            available: !reservation && !slot.occupied,
            reservation: reservation || null,
            occupied: slot.occupied
        };
    });
    
    res.json({
        success: true,
        date,
        availability
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

// Socket.IO para actualizaciones en tiempo real
io.on('connection', (socket) => {
    console.log('🔌 Cliente conectado para actualizaciones en tiempo real');
    
    // Enviar estado actual al cliente recién conectado
    const occupiedSlots = parkingState.slots.filter(s => s.occupied).length;
    const availableSlots = SLOTS_COUNT - occupiedSlots;
    const vehiclesInside = parkingState.entryCount - parkingState.exitCount;
    
    socket.emit('initialState', {
        slots: parkingState.slots,
        entryCount: parkingState.entryCount,
        exitCount: parkingState.exitCount,
        vehiclesInside,
        occupiedSlots,
        availableSlots,
        totalSlots: SLOTS_COUNT
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado');
    });
});

// Iniciar servidor
server.listen(PORT, () => {
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
    console.log(`\n🔌 Socket.IO habilitado para actualizaciones en tiempo real`);
});
