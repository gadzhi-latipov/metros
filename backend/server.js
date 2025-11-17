import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://frommetro.vercel.app',
    'http://localhost:3000', 
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json());

// Мок данные для API
const mockUsers = [
  {
    id: 1,
    name: 'Анна',
    station: 'Площадь Восстания',
    wagon: '2',
    color: 'Красная куртка',
    colorCode: '#dc3545',
    status: 'Стою у двери в вагоне | Хорошее настроение',
    timer: "05:00",
    online: true,
    city: 'spb',
    gender: 'female',
    position: 'Стою у двери в вагоне',
    mood: 'Хорошее настроение',
    isWaiting: false,
    isConnected: true,
    show_timer: true,
    timer_seconds: 300
  }
];

// API Routes
app.get('/api/users', (req, res) => {
  console.log('📥 GET /api/users');
  res.json(mockUsers);
});

app.post('/api/users', (req, res) => {
  console.log('📥 POST /api/users', req.body);
  const newUser = {
    id: Date.now(),
    ...req.body,
    created_at: new Date().toISOString()
  };
  mockUsers.push(newUser);
  res.json(newUser);
});

app.get('/api/stations/waiting-room', (req, res) => {
  const city = req.query.city || 'spb';
  console.log('📥 GET /api/stations/waiting-room', { city });
  
  res.json({
    stationStats: [
      { station: 'Площадь Восстания', waiting: 2, connected: 1, totalUsers: 3 },
      { station: 'Владимирская', waiting: 1, connected: 0, totalUsers: 1 }
    ],
    totalStats: {
      total_waiting: 4,
      total_connected: 5, 
      total_users: 9
    }
  });
});

app.post('/api/users/:id/ping', (req, res) => {
  console.log('📥 POST /api/users/:id/ping', req.params.id);
  res.json({ success: true });
});

app.put('/api/users/:id', (req, res) => {
  console.log('📥 PUT /api/users/:id', req.params.id, req.body);
  
  const userId = parseInt(req.params.id);
  const userIndex = mockUsers.findIndex(user => user.id === userId);
  
  if (userIndex !== -1) {
    // Обновляем пользователя
    mockUsers[userIndex] = { ...mockUsers[userIndex], ...req.body };
    console.log('✅ Пользователь обновлен:', mockUsers[userIndex]);
    res.json(mockUsers[userIndex]);
  } else {
    res.status(404).json({ error: 'Пользователь не найден' });
  }
});

// Добавляем недостающий endpoint для join-station
app.post('/api/rooms/join-station', (req, res) => {
  console.log('📥 POST /api/rooms/join-station', req.body);
  
  const { station, userId } = req.body;
  
  // Находим пользователя и обновляем его станцию
  const userIndex = mockUsers.findIndex(user => user.id === userId);
  if (userIndex !== -1) {
    mockUsers[userIndex].station = station;
    mockUsers[userIndex].isWaiting = false;
    mockUsers[userIndex].isConnected = true;
    mockUsers[userIndex].status = `Выбрал станцию: ${station}`;
    
    console.log('✅ Пользователь присоединился к станции:', mockUsers[userIndex]);
  }
  
  // Возвращаем всех пользователей на этой станции
  const stationUsers = mockUsers.filter(user => user.station === station && user.isConnected === true);
  
  res.json({ 
    success: true,
    users: stationUsers
  });
});

// Health check для Render
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 CORS enabled for: frommetro.vercel.app`);
});