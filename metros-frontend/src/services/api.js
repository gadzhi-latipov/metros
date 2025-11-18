// Временный мок API для разработки
let useMockData = false; // переключите на false когда CORS заработает

const BASE_URL = 'https://metro-backend-xlkt.onrender.com/api';

console.log('🌐 API URL:', BASE_URL);

// УДАЛИТЕ ЭТОТ ДУБЛИРУЮЩИЙСЯ КОД:
// let useMockData = false;
// console.log('🌐 API Base URL:', BASE_URL);

async function makeRequest(endpoint, options = {}) {
  if (useMockData) {
    console.log('🎭 Используем мок данные для:', endpoint);
    // Имитируем задержку сети
    await new Promise(resolve => setTimeout(resolve, 500));
    return mockResponse(endpoint, options);
  }

  const url = `${BASE_URL}${endpoint}`;
  console.log('🌐 Отправка запроса:', url);
  
  const config = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  if (options.body) {
    config.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Ошибка запроса:', error);
    // Fallback на мок данные при ошибке
    console.log('🔄 Используем fallback мок данные');
    return mockResponse(endpoint, options);
  }
}

// Мок responses
function mockResponse(endpoint, options) {
  switch (endpoint) {
    case '/users':
      if (options.method === 'POST') {
        return {
          id: Date.now(),
          ...JSON.parse(options.body),
          created_at: new Date().toISOString()
        };
      }
      return [
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
        },
        {
          id: 2,
          name: 'Михаил',
          station: 'Пушкинская',
          wagon: '5',
          color: 'Синяя куртка',
          colorCode: '#007bff',
          status: 'Сижу читаю в вагоне | Просто наблюдаю',
          timer: "10:00",
          online: true,
          city: 'spb',
          gender: 'male',
          position: 'Сижу читаю в вагоне',
          mood: 'Просто наблюдаю',
          isWaiting: false,
          isConnected: true,
          show_timer: true,
          timer_seconds: 600
        }
      ];

    case '/stations/waiting-room':
      const url = new URL(`http://test.com${endpoint}`);
      const city = url.searchParams.get('city') || 'spb';
      
      // Все станции для выбранного города
      const allStations = city === 'moscow' ? [
        'Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская'
      ] : [
        'Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор'
      ];
      
      // Создаем статистику для всех станций
      const stationStats = allStations.map(station => ({
        station,
        waiting: Math.floor(Math.random() * 3),
        connected: Math.floor(Math.random() * 3),
        totalUsers: Math.floor(Math.random() * 5)
      }));
      
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

    case '/stations/join':
      return {
        success: true,
        users: [
          {
            id: 1,
            name: 'Анна',
            station: JSON.parse(options.body).station,
            wagon: '2',
            color: 'Красная куртка',
            status: 'Стою у двери в вагоне | Хорошее настроение',
            show_timer: true,
            timer_seconds: 300
          }
        ]
      };

    default:
      if (endpoint.startsWith('/users/') && endpoint.endsWith('/ping')) {
        return { success: true };
      }
      if (endpoint.startsWith('/users/') && options.method === 'PUT') {
        return { success: true };
      }
      return { success: true };
  }
}

export const api = {
  createUser: async (userData) => {
    console.log('📍 Отправка данных пользователя:', userData);
    return makeRequest('/users', {
      method: 'POST',
      body: userData
    });
  },

  getStationsStats: async (city) => {
    return makeRequest(`/stations/waiting-room?city=${city}`);
  },

  getUsers: async () => {
    return makeRequest('/users');
  },

  updateUser: async (userId, data) => {
    console.log('📝 Обновление пользователя:', userId, data);
    return makeRequest(`/users/${userId}`, {
      method: 'PUT',
      body: data
    });
  },

  deleteUser: async (userId) => {
    console.log('🗑️ Удаление пользователя:', userId);
    return makeRequest(`/users/${userId}`, {
      method: 'DELETE'
    });
  },

  joinStation: async (data) => {
    console.log('🚇 Присоединение к станции:', data);
    return makeRequest('/rooms/join-station', {
      method: 'POST',
      body: data
    });
  },

  pingActivity: async (userId) => {
    console.log('📡 Пинг активности:', userId);
    return makeRequest(`/users/${userId}/ping`, {
      method: 'POST'
    });
  }
};

export const helpers = {
  getRandomName: (gender) => {
    const maleNames = ['Иван-Царевич', 'Кощей Бессмертный', 'Добрыня Никитич', 'Леший', 'Водяной', 'Бабай', 'Соловей-Разбойник', 'Змей Горыныч'];
    const femaleNames = ['Василиса Премудрая', 'Баба Яга', 'Царевна-Лягушка', 'Снегурочка', 'Марья-Искусница', 'Аленушка', 'Кикимора', 'Русалка'];

    const names = gender === 'male' ? maleNames : femaleNames;
    return names[Math.floor(Math.random() * names.length)];
  },

  getRandomColor: () => {
    const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14', '#20c997'];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  formatTime: (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  },

  stations: {
    moscow: ['Авиамоторная', 'Автозаводская', 'Академическая', 'Александровский сад', 'Алексеевская',
        'Алтуфьево', 'Аннино', 'Арбатская', 'Аэропорт', 'Бабушкинская',
        'Багратионовская', 'Баррикадная', 'Бауманская', 'Беговая', 'Белорусская',
        'Беляево', 'Бибирево', 'Библиотека им. Ленина', 'Боровицкая', 'Ботанический сад',
        'Братиславская', 'Бульвар Дмитрия Донского', 'Бунинская аллея', 'Варшавская', 'ВДНХ',
        'Владыкино', 'Водный стадион', 'Войковская', 'Волгоградский проспект', 'Волжская',
        'Воробьёвы горы', 'Выставочная', 'Выхино', 'Деловой центр', 'Динамо'],
    spb: ['Адмиралтейская', 'Балтийская', 'Василеостровская', 'Владимирская', 'Гостиный двор',
        'Горьковская', 'Достоевская', 'Елизаровская', 'Звенигородская', 'Кировский завод',
        'Ладожская', 'Лиговский проспект', 'Ломоносовская', 'Маяковская', 'Невский проспект',
        'Обводный канал', 'Озерки', 'Парк Победы', 'Петроградская', 'Площадь Восстания',
        'Площадь Ленина', 'Приморская', 'Пролетарская', 'Проспект Ветеранов', 'Проспект Просвещения',
        'Пушкинская', 'Садовая', 'Сенная площадь', 'Спасская', 'Спортивная',
        'Старая Деревня', 'Технологический институт', 'Фрунзенская', 'Чернышевская', 'Чкаловская']
  }
};