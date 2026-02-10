import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://frommetro.vercel.app',
    'https://metros-git-main-ruslans-projects-c1667076.vercel.app',
    'https://metros-ruslans-projects-c1667076.vercel.app',
    'http://localhost:3000', 
    'http://localhost:5173'
  ],
  credentials: true
}));

app.use(express.json());

// Оптимизированное хранение пользователей в памяти
let mockUsers = [
  {
    id: 1,
    name: 'Анна',
    station: 'Площадь Восстания',
    wagon: '2',
    color: 'Красная куртка',
    colorCode: '#dc3545',
    status: 'Стою у двери в вагоне | Хорошее настроение',
    timer: "00:00",
    online: true,
    city: 'spb',
    gender: 'female',
    position: 'Стою у двери в вагоне',
    mood: 'Хорошее настроение',
    is_waiting: false,
    is_connected: true,
    session_id: 'session_metro_1',
    device_id: 'device_1',
    vk_user_id: null,
    last_seen: new Date().toISOString()
  }
];

// Кэш для оптимизации
let stationCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 5000; // 5 секунд

// Очистка неактивных пользователей
const cleanupInactiveUsers = () => {
  const now = new Date();
  const inactiveTime = new Date(now.getTime() - 5 * 60 * 1000); // 5 минут
  
  mockUsers = mockUsers.map(user => {
    const lastSeen = new Date(user.last_seen || user.created_at || 0);
    if (lastSeen < inactiveTime && user.online) {
      return {
        ...user,
        online: false,
        is_connected: false,
        is_waiting: false,
        status: 'Оффлайн (неактивность)'
      };
    }
    return user;
  });
  
  console.log('🧹 Проверка неактивных пользователей выполнена');
};

// Запускаем очистку каждую минуту
setInterval(cleanupInactiveUsers, 60000);

// Оптимизированная функция для получения статистики станций
const getStationStats = (city) => {
  const now = Date.now();
  
  // Проверяем кэш
  const cacheKey = `stats_${city}`;
  if (stationCache[cacheKey] && (now - lastCacheUpdate) < CACHE_TTL) {
    return stationCache[cacheKey];
  }
  
  // Все станции для выбранного города
  const allStations = city === 'moscow' ? [
    'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
    'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская'
  ] : [
    'Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор',
    'Горьковская', 'Достоевская', 'Елизаровская', 'Звенигородская', 'Кировский завод'
  ];
  
  // Создаем статистику для ВСЕХ станций
  const stationStats = allStations.map(station => {
    // Подсчитываем реальных пользователей на каждой станции
    const stationUsers = mockUsers.filter(user => 
      user.station === station && user.online === true
    );
    
    const waiting = stationUsers.filter(user => user.is_waiting).length;
    const connected = stationUsers.filter(user => user.is_connected).length;
    
    return {
      station,
      waiting,
      connected,
      totalUsers: stationUsers.length
    };
  });
  
  const total_waiting = stationStats.reduce((sum, stat) => sum + stat.waiting, 0);
  const total_connected = stationStats.reduce((sum, stat) => sum + stat.connected, 0);
  
  const result = {
    stationStats,
    totalStats: {
      total_waiting,
      total_connected, 
      total_users: total_waiting + total_connected
    }
  };
  
  // Сохраняем в кэш
  stationCache[cacheKey] = result;
  lastCacheUpdate = now;
  
  return result;
};

// API Routes
app.get('/api/users', (req, res) => {
  res.json(mockUsers.filter(user => user.online === true));
});

app.post('/api/users', (req, res) => {
  const newUser = {
    id: Date.now(),
    ...req.body,
    created_at: new Date().toISOString()
  };
  
  // Очищаем старые сессии с того же устройства
  if (newUser.device_id) {
    mockUsers = mockUsers.map(user => {
      if (user.device_id === newUser.device_id && user.online === true) {
        return {
          ...user,
          online: false,
          is_connected: false,
          is_waiting: false,
          status: 'Сессия заменена'
        };
      }
      return user;
    });
  }
  
  mockUsers.push(newUser);
  
  // Инвалидируем кэш
  stationCache = {};
  
  res.json(newUser);
});

app.get('/api/stations/waiting-room', (req, res) => {
  const city = req.query.city || 'spb';
  const stats = getStationStats(city);
  res.json(stats);
});

app.post('/api/users/:id/ping', (req, res) => {
  const userId = parseInt(req.params.id);
  const userIndex = mockUsers.findIndex(user => user.id === userId);
  
  if (userIndex !== -1) {
    mockUsers[userIndex].last_seen = new Date().toISOString();
    
    // Обновляем статус если переданы данные
    if (req.body) {
      mockUsers[userIndex] = { ...mockUsers[userIndex], ...req.body };
    }
    
    // Инвалидируем кэш
    stationCache = {};
    
    res.json({ success: true, user: mockUsers[userIndex] });
  } else {
    res.status(404).json({ error: 'Пользователь не найден' });
  }
});

app.put('/api/users/:id', (req, res) => {
  const userId = parseInt(req.params.id);
  const userIndex = mockUsers.findIndex(user => user.id === userId);
  
  if (userIndex !== -1) {
    // Обновляем пользователя
    mockUsers[userIndex] = { 
      ...mockUsers[userIndex], 
      ...req.body,
      last_seen: new Date().toISOString()
    };
    
    // Инвалидируем кэш
    stationCache = {};
    
    res.json(mockUsers[userIndex]);
  } else {
    res.status(404).json({ error: 'Пользователь не найден' });
  }
});

app.post('/api/rooms/join-station', (req, res) => {
  const { station, userId } = req.body;
  
  // Находим пользователя и обновляем его станцию
  const userIndex = mockUsers.findIndex(user => user.id === userId);
  if (userIndex !== -1) {
    mockUsers[userIndex].station = station;
    mockUsers[userIndex].is_waiting = false;
    mockUsers[userIndex].is_connected = true;
    mockUsers[userIndex].status = `Выбрал станцию: ${station}`;
    mockUsers[userIndex].last_seen = new Date().toISOString();
  }
  
  // Возвращаем всех пользователей на этой станции
  const stationUsers = mockUsers.filter(user => 
    user.station === station && 
    user.is_connected === true &&
    user.online === true
  );
  
  // Инвалидируем кэш
  stationCache = {};
  
  res.json({ 
    success: true,
    users: stationUsers
  });
});

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    usersOnline: mockUsers.filter(u => u.online).length,
    cacheStatus: Object.keys(stationCache).length > 0 ? 'active' : 'empty'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 CORS включен для: frommetro.vercel.app`);
  console.log(`💾 Кэш статистики: активен (TTL: ${CACHE_TTL}ms)`);
});