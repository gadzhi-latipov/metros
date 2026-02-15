// services/api.js - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ

const BASE_URL = 'https://metro-backend-xlkt.onrender.com/api';
const USE_MOCK_FALLBACK = true; // Всегда использовать мок при ошибках

// Кэш запросов
const cache = {
  users: { data: null, time: 0 },
  stats: { data: null, time: 0 }
};

const CACHE_TTL = 2000; // 2 секунды

// Очередь запросов
let pendingRequests = {};
let requestQueue = [];
let isProcessing = false;

// Быстрый fetch с таймаутом
const fastFetch = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 секунды таймаут
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

// Обработка очереди
const processRequestQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const request = requestQueue.shift();
  
  try {
    const result = await fastFetch(request.url, request.options);
    request.resolve(result);
  } catch (error) {
    // Возвращаем мок при ошибке
    const mockData = getMockResponse(request.url, request.options);
    if (mockData) {
      request.resolve(mockData);
    } else {
      request.reject(error);
    }
  } finally {
    isProcessing = false;
    if (requestQueue.length > 0) {
      setTimeout(processRequestQueue, 10);
    }
  }
};

// Добавление в очередь
const queuedFetch = (endpoint, options = {}) => {
  return new Promise((resolve, reject) => {
    requestQueue.push({
      url: `${BASE_URL}${endpoint}`,
      options,
      resolve,
      reject
    });
    
    if (!isProcessing) {
      processRequestQueue();
    }
  });
};

// Мок данные (быстрые)
const getMockResponse = (url, options) => {
  const method = options.method || 'GET';
  const endpoint = url.replace(BASE_URL, '');
  
  // Кэшированные мок-пользователи
  const mockUsers = [
    {
      id: 1,
      name: 'Анна',
      station: 'Площадь Восстания',
      wagon: '2',
      color: 'Красная куртка',
      colorCode: '#dc3545',
      status: 'На станции',
      online: true,
      city: 'spb',
      gender: 'female',
      position: 'Стою у двери',
      mood: 'Хорошее',
      is_waiting: false,
      is_connected: true,
      last_seen: new Date().toISOString()
    },
    {
      id: 2,
      name: 'Михаил',
      station: 'Пушкинская',
      wagon: '5',
      color: 'Синяя куртка',
      colorCode: '#007bff',
      status: 'В вагоне',
      online: true,
      city: 'spb',
      gender: 'male',
      position: 'Читаю',
      mood: 'Сплю',
      is_waiting: false,
      is_connected: true,
      last_seen: new Date().toISOString()
    }
  ];

  const stations = {
    moscow: ['Авиамоторная', 'Автозаводская', 'Академическая'],
    spb: ['Адмиралтейская', 'Балтийская', 'Василеостровская', 'Площадь Восстания', 'Пушкинская']
  };

  // GET /users
  if (endpoint === '/users' && method === 'GET') {
    return mockUsers.filter(u => u.online);
  }

  // POST /users
  if (endpoint === '/users' && method === 'POST') {
    const body = JSON.parse(options.body);
    return {
      id: Date.now(),
      ...body,
      colorCode: body.colorCode || '#007bff',
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString()
    };
  }

  // GET /stations/waiting-room
  if (endpoint.startsWith('/stations/waiting-room')) {
    const city = new URLSearchParams(endpoint.split('?')[1] || '').get('city') || 'spb';
    const cityStations = stations[city] || stations.spb;
    
    const stats = cityStations.map(station => ({
      station,
      waiting: station === 'Площадь Восстания' ? 1 : 0,
      connected: station === 'Пушкинская' ? 2 : 0
    }));
    
    return {
      stationStats: stats,
      totalStats: {
        waiting: 1,
        connected: 2,
        total: 3
      }
    };
  }

  // PUT /users/:id
  if (endpoint.match(/^\/users\/\d+$/) && method === 'PUT') {
    const body = JSON.parse(options.body);
    return {
      id: parseInt(endpoint.split('/')[2]),
      ...body,
      last_seen: new Date().toISOString()
    };
  }

  // POST /users/:id/ping
  if (endpoint.includes('/ping') && method === 'POST') {
    return { success: true };
  }

  return null;
};

// API методы с кэшированием
export const api = {
  async getUsers(force = false) {
    const now = Date.now();
    if (!force && cache.users.data && now - cache.users.time < CACHE_TTL) {
      return cache.users.data;
    }
    
    try {
      const data = await queuedFetch('/users');
      cache.users = { data, time: now };
      return data;
    } catch (error) {
      if (USE_MOCK_FALLBACK) {
        const mock = getMockResponse('/users', { method: 'GET' });
        cache.users = { data: mock, time: now };
        return mock;
      }
      throw error;
    }
  },

  async createUser(userData) {
    try {
      const data = await queuedFetch('/users', {
        method: 'POST',
        body: userData
      });
      cache.users.time = 0; // Инвалидируем кэш
      return data;
    } catch (error) {
      if (USE_MOCK_FALLBACK) {
        return getMockResponse('/users', { method: 'POST', body: JSON.stringify(userData) });
      }
      throw error;
    }
  },

  async updateUser(userId, updateData) {
    try {
      const data = await queuedFetch(`/users/${userId}`, {
        method: 'PUT',
        body: updateData
      });
      cache.users.time = 0; // Инвалидируем кэш
      return data;
    } catch (error) {
      if (USE_MOCK_FALLBACK) {
        return { id: userId, ...updateData };
      }
      throw error;
    }
  },

  async pingActivity(userId, updateData = {}) {
    try {
      return await queuedFetch(`/users/${userId}/ping`, {
        method: 'POST',
        body: updateData
      });
    } catch (error) {
      return { success: true }; // Всегда успех при ошибке
    }
  },

  async getStationsStats(city = 'spb', force = false) {
    const now = Date.now();
    const cacheKey = `stats_${city}`;
    
    if (!force && cache.stats.data && now - cache.stats.time < CACHE_TTL) {
      return cache.stats.data;
    }
    
    try {
      const data = await queuedFetch(`/stations/waiting-room?city=${city}`);
      cache.stats = { data, time: now };
      return data;
    } catch (error) {
      if (USE_MOCK_FALLBACK) {
        const mock = getMockResponse(`/stations/waiting-room?city=${city}`, { method: 'GET' });
        cache.stats = { data: mock, time: now };
        return mock;
      }
      throw error;
    }
  },

  async joinStation(data) {
    try {
      return await queuedFetch('/rooms/join-station', {
        method: 'POST',
        body: data
      });
    } catch (error) {
      if (USE_MOCK_FALLBACK) {
        return { success: true, users: [] };
      }
      throw error;
    }
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
    const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
};