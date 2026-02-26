// services/api.js

const BASE_URL = 'https://metro-backend-xlkt.onrender.com/api';
const USE_MOCK_DATA = false; // Переключите на true для разработки без бэкенда

// Кэш в памяти для быстрого доступа
let usersCache = null;
let usersCacheTime = 0;
let statsCache = {};
const CACHE_TTL = 2000; // 2 секунды кэширования

// Очередь запросов для предотвращения спама
let requestQueue = [];
let isProcessing = false;
let lastRequestTime = 0;
const REQUEST_DELAY = 100; // 100ms между запросами (уменьшили для скорости)

// Обработка очереди запросов
const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  // Ждем если запросы слишком частые
  if (timeSinceLastRequest < REQUEST_DELAY) {
    await new Promise(resolve => 
      setTimeout(resolve, REQUEST_DELAY - timeSinceLastRequest)
    );
  }
  
  const request = requestQueue.shift();
  try {
    lastRequestTime = Date.now();
    
    if (USE_MOCK_DATA) {
      // Используем мок данные
      await new Promise(resolve => setTimeout(resolve, 50)); // Минимальная задержка
      const mockResponse = getMockResponse(request.endpoint, request.options);
      request.resolve(mockResponse);
    } else {
      // Реальный запрос
      const response = await fetch(`${BASE_URL}${request.endpoint}`, request.options);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      request.resolve(data);
    }
  } catch (error) {
    console.warn(`API Error [${request.options.method} ${request.endpoint}]:`, error.message);
    
    // При ошибке 404 для станций, возвращаем пустой массив (нет пользователей)
    if (error.message.includes('HTTP 404') && request.endpoint.includes('/stations/')) {
      console.log(`📭 Станция не найдена или нет пользователей, возвращаем пустой массив`);
      request.resolve([]);
    } else {
      // В остальных случаях используем мок данные
      console.log('🔄 Используем fallback мок данные');
      try {
        const mockResponse = getMockResponse(request.endpoint, request.options);
        request.resolve(mockResponse);
      } catch (mockError) {
        request.reject(error);
      }
    }
  } finally {
    isProcessing = false;
    if (requestQueue.length > 0) {
      setTimeout(processQueue, 50);
    }
  }
};

// Добавление запроса в очередь
const queuedRequest = (endpoint, options = {}) => {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    if (options.body) {
      defaultOptions.body = JSON.stringify(options.body);
    }

    requestQueue.push({
      endpoint,
      options: defaultOptions,
      resolve,
      reject
    });
    
    if (!isProcessing) {
      processQueue();
    }
  });
};

// Мок данные для разработки
const getMockResponse = (endpoint, options) => {
  const mockUsers = [
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
    },
    {
      id: 2,
      name: 'Михаил',
      station: 'Пушкинская',
      wagon: '5',
      color: 'Синяя куртка',
      colorCode: '#007bff',
      status: 'Сижу читаю в вагоне | Просто наблюдаю',
      timer: "00:00",
      online: true,
      city: 'spb',
      gender: 'male',
      position: 'Сижу читаю в вагоне',
      mood: 'Просто наблюдаю',
      is_waiting: false,
      is_connected: true,
      session_id: 'session_metro_2',
      device_id: 'device_2',
      vk_user_id: null,
      last_seen: new Date().toISOString()
    },
    {
      id: 3,
      name: 'Елена',
      station: 'Василеостровская',
      wagon: '3',
      color: 'Синее пальто',
      colorCode: '#17a2b8',
      status: 'Брожу по станции | Хорошее настроение',
      online: true,
      city: 'spb',
      gender: 'female',
      position: 'Брожу по станции',
      mood: 'Хорошее настроение',
      is_waiting: false,
      is_connected: true,
      session_id: 'session_metro_3',
      device_id: 'device_3',
      vk_user_id: null,
      last_seen: new Date().toISOString()
    }
  ];

  const stations = {
    moscow: [
      'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
      'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская'
    ],
    spb: [
      'Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор',
      'Горьковская', 'Достоевская', 'Елизаровская', 'Звенигородская', 'Кировский завод',
      'Ладожская', 'Лиговский проспект', 'Ломоносовская', 'Маяковская', 'Невский проспект',
      'Обводный канал', 'Озерки', 'Парк Победы', 'Петроградская', 'Площадь Восстания',
      'Площадь Ленина', 'Приморская', 'Пролетарская', 'Проспект Ветеранов', 'Проспект Просвещения',
      'Пушкинская', 'Садовая', 'Сенная площадь', 'Спасская', 'Спортивная'
    ]
  };

  // Обработка динамических endpoint'ов
  if (endpoint.match(/^\/stations\/.+\/users$/)) {
    // Эндпоинт для получения пользователей станции
    const station = decodeURIComponent(endpoint.split('/')[2]);
    console.log(`📡 Мок: запрос пользователей для станции ${station}`);
    
    // Фильтруем пользователей по станции
    const stationUsers = mockUsers.filter(user => 
      user.station === station && 
      user.is_connected === true &&
      user.online === true
    );
    
    return stationUsers;
  }

  switch (endpoint) {
    case '/users':
      if (options.method === 'GET') {
        return mockUsers.filter(user => user.online);
      }
      if (options.method === 'POST') {
        const newUser = {
          id: Date.now(),
          ...JSON.parse(options.body),
          created_at: new Date().toISOString(),
          last_seen: new Date().toISOString()
        };
        
        // Добавляем цвет если его нет
        if (!newUser.colorCode) {
          const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'];
          newUser.colorCode = colors[Math.floor(Math.random() * colors.length)];
        }
        
        return newUser;
      }
      return mockUsers;

    case '/stations/waiting-room':
      const url = new URL(`http://test.com${endpoint}`);
      const city = url.searchParams.get('city') || 'spb';
      const cityStations = stations[city] || stations.spb;
      
      const stationStats = cityStations.map(station => {
        const stationUsers = mockUsers.filter(user => user.station === station && user.online);
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
      
      return {
        stationStats,
        totalStats: {
          total_waiting,
          total_connected,
          total_users: total_waiting + total_connected
        }
      };

    case '/rooms/join-station':
      const body = JSON.parse(options.body);
      const stationUsers = mockUsers.filter(user => 
        user.station === body.station && 
        user.is_connected === true &&
        user.online === true
      );
      
      return {
        success: true,
        users: stationUsers
      };

    default:
      if (endpoint.startsWith('/users/') && endpoint.endsWith('/ping')) {
        return { success: true };
      }
      
      if (endpoint.startsWith('/users/') && options.method === 'PUT') {
        const userId = parseInt(endpoint.split('/')[2]);
        const user = mockUsers.find(u => u.id === userId);
        
        if (user) {
          const updateData = JSON.parse(options.body);
          return { ...user, ...updateData, last_seen: new Date().toISOString() };
        }
        
        return { success: false, error: 'Пользователь не найден' };
      }
      
      return { success: true };
  }
};

// API методы
export const api = {
  // Получение всех пользователей (с кэшированием)
  async getUsers(force = false) {
    const now = Date.now();
    
    // Возвращаем из кэша если данные свежие
    if (!force && usersCache && (now - usersCacheTime) < CACHE_TTL) {
      return usersCache;
    }
    
    const data = await queuedRequest('/users');
    usersCache = data;
    usersCacheTime = now;
    return data;
  },

  // Создание нового пользователя
  async createUser(userData) {
    const data = await queuedRequest('/users', {
      method: 'POST',
      body: userData
    });
    // Инвалидируем кэш
    usersCache = null;
    statsCache = {};
    return data;
  },

  // Обновление пользователя
  async updateUser(userId, updateData) {
    const data = await queuedRequest(`/users/${userId}`, {
      method: 'PUT',
      body: updateData
    });
    // Инвалидируем кэш
    usersCache = null;
    statsCache = {};
    return data;
  },

  // Ping активности
  async pingActivity(userId, updateData = {}) {
    return queuedRequest(`/users/${userId}/ping`, {
      method: 'POST',
      body: updateData
    });
  },

  // Получение статистики станций (с кэшированием)
  async getStationsStats(city = 'spb', force = false) {
    const cacheKey = `stats_${city}`;
    const now = Date.now();
    
    // Возвращаем из кэша если данные свежие
    if (!force && statsCache[cacheKey] && (now - statsCache[cacheKey].time) < CACHE_TTL) {
      return statsCache[cacheKey].data;
    }
    
    const data = await queuedRequest(`/stations/waiting-room?city=${city}`);
    statsCache[cacheKey] = {
      data,
      time: now
    };
    return data;
  },

  // НОВЫЙ ОПТИМИЗИРОВАННЫЙ МЕТОД: получение пользователей конкретной станции
  async getStationUsers(station) {
    try {
      const encodedStation = encodeURIComponent(station);
      const data = await queuedRequest(`/stations/${encodedStation}/users`);
      return data || []; // Всегда возвращаем массив
    } catch (error) {
      console.warn(`Error getting users for station ${station}:`, error);
      return []; // При ошибке возвращаем пустой массив
    }
  },

  // Присоединение к станции
  async joinStation(data) {
    const result = await queuedRequest('/rooms/join-station', {
      method: 'POST',
      body: data
    });
    // Инвалидируем кэш
    usersCache = null;
    statsCache = {};
    return result;
  }
};

export const helpers = {
  stations: {
    moscow: [
      'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
      'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская',
      'Багратионовская', 'Баррикадная', 'Бауманская', 'Беговая', 'Белорусская',
      'Беляево', 'Бибирево', 'Библиотека им. Ленина', 'Боровицкая', 'Ботанический сад',
      'Братиславская', 'Бульвар Дмитрия Донского', 'Бунинская аллея', 'Варшавская', 'ВДНХ',
      'Владыкино', 'Водный стадион', 'Войковская', 'Волгоградский проспект', 'Волжская',
      'Воробьёвы горы', 'Выставочная', 'Выхино', 'Деловой центр', 'Динамо'
    ],
    spb: [
      'Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор',
      'Горьковская', 'Достоевская', 'Елизаровская', 'Звенигородская', 'Кировский завод',
      'Ладожская', 'Лиговский проспект', 'Ломоносовская', 'Маяковская', 'Невский проспект',
      'Обводный канал', 'Озерки', 'Парк Победы', 'Петроградская', 'Площадь Восстания',
      'Площадь Ленина', 'Приморская', 'Пролетарская', 'Проспект Ветеранов', 'Проспект Просвещения',
      'Пушкинская', 'Садовая', 'Сенная площадь', 'Спасская', 'Спортивная',
      'Старая Деревня', 'Технологический институт', 'Фрунзенская', 'Чернышевская', 'Чкаловская'
    ]
  },
  
  getRandomColor() {
    const colors = [
      '#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8',
      '#6f42c1', '#e83e8c', '#fd7e14', '#20c997', '#6610f2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
};

// Экспорт для отладки
if (process.env.NODE_ENV === 'development') {
  window.api = api;
  window.helpers = helpers;
}