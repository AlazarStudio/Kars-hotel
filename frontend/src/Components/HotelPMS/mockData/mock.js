// Today = 2026-04-23

export const mockHotel = {
  id: 'hotel-1',
  name: 'Отель «Парковый»',
  city: 'Москва',
  address: 'ул. Лесная, 42',
  phone: '+7 (495) 123-45-67',
  email: 'reception@parkoviy.ru',
  stars: 3,
};

export const mockCategories = [
  { id: 'cat-std',    name: 'Стандарт',   capacity: 2, basePrice: 3800 },
  { id: 'cat-dlx',    name: 'Делюкс',     capacity: 2, basePrice: 5900 },
  { id: 'cat-semi',   name: 'Полулюкс',   capacity: 2, basePrice: 8500 },
  { id: 'cat-lux',    name: 'Люкс',       capacity: 2, basePrice: 13000 },
];

export const mockRooms = [
  { id: 'r101', number: '101', categoryId: 'cat-std',  floor: 1, hk: 'dirty'    },
  { id: 'r102', number: '102', categoryId: 'cat-std',  floor: 1, hk: 'clean'    },
  { id: 'r103', number: '103', categoryId: 'cat-std',  floor: 1, hk: 'ready'    },
  { id: 'r104', number: '104', categoryId: 'cat-std',  floor: 1, hk: 'cleaning' },
  { id: 'r105', number: '105', categoryId: 'cat-std',  floor: 1, hk: 'ready'    },
  { id: 'r106', number: '106', categoryId: 'cat-std',  floor: 1, hk: 'dirty'    },
  { id: 'r107', number: '107', categoryId: 'cat-std',  floor: 1, hk: 'ready'    },
  { id: 'r108', number: '108', categoryId: 'cat-std',  floor: 1, hk: 'checking' },
  { id: 'r201', number: '201', categoryId: 'cat-dlx',  floor: 2, hk: 'ready'    },
  { id: 'r202', number: '202', categoryId: 'cat-dlx',  floor: 2, hk: 'dirty'    },
  { id: 'r203', number: '203', categoryId: 'cat-dlx',  floor: 2, hk: 'clean'    },
  { id: 'r204', number: '204', categoryId: 'cat-dlx',  floor: 2, hk: 'ready'    },
  { id: 'r205', number: '205', categoryId: 'cat-dlx',  floor: 2, hk: 'ready'    },
  { id: 'r206', number: '206', categoryId: 'cat-dlx',  floor: 2, hk: 'cleaning' },
  { id: 'r301', number: '301', categoryId: 'cat-semi', floor: 3, hk: 'ready'    },
  { id: 'r302', number: '302', categoryId: 'cat-semi', floor: 3, hk: 'dirty'    },
  { id: 'r303', number: '303', categoryId: 'cat-semi', floor: 3, hk: 'ready'    },
  { id: 'r304', number: '304', categoryId: 'cat-semi', floor: 3, hk: 'clean'    },
  { id: 'r401', number: '401', categoryId: 'cat-lux',  floor: 4, hk: 'ready'    },
  { id: 'r402', number: '402', categoryId: 'cat-lux',  floor: 4, hk: 'dirty'    },
  { id: 'r403', number: '403', categoryId: 'cat-lux',  floor: 4, hk: 'ready'    },
];

let _nextId = 100;
const uid = () => `b${_nextId++}`;

export const mockBookings = [
  // ─── Стандарт 101 ───
  { id: uid(), roomId: 'r101', guestName: 'Смирнов Алексей Владимирович',    phone: '+7 (916) 111-22-33', email: 'smirnov@mail.ru',   checkIn: '2026-04-18', checkOut: '2026-04-25', status: 'checked_in',  adults: 2, children: 0, totalPrice: 26600, source: 'direct',    notes: '' },
  { id: uid(), roomId: 'r101', guestName: 'Петрова Наталья Сергеевна',       phone: '+7 (925) 444-55-66', email: 'petrova@yandex.ru', checkIn: '2026-04-28', checkOut: '2026-05-03', status: 'confirmed',   adults: 1, children: 0, totalPrice: 19000, source: 'online',    notes: 'Поздний выезд до 14:00' },
  // ─── Стандарт 102 ───
  { id: uid(), roomId: 'r102', guestName: 'Козлов Дмитрий Иванович',         phone: '+7 (903) 777-88-99', email: 'kozlov@gmail.com',  checkIn: '2026-04-20', checkOut: '2026-04-23', status: 'checked_out', adults: 2, children: 0, totalPrice: 11400, source: 'phone',     notes: '' },
  { id: uid(), roomId: 'r102', guestName: 'Новикова Екатерина Андреевна',    phone: '+7 (916) 321-65-87', email: 'novikova@mail.ru',  checkIn: '2026-04-24', checkOut: '2026-04-30', status: 'confirmed',   adults: 2, children: 1, totalPrice: 22800, source: 'direct',    notes: 'Доп. кровать для ребёнка' },
  // ─── Стандарт 103 ───
  { id: uid(), roomId: 'r103', guestName: 'Морозов Игорь Петрович',          phone: '+7 (977) 555-12-34', email: '',                  checkIn: '2026-04-22', checkOut: '2026-04-27', status: 'checked_in',  adults: 1, children: 0, totalPrice: 19000, source: 'corporate', notes: 'Командировка, оплата по счёту' },
  { id: uid(), roomId: 'r103', guestName: 'Соколова Мария Александровна',    phone: '+7 (999) 101-20-30', email: 'sokolova@bk.ru',    checkIn: '2026-04-30', checkOut: '2026-05-05', status: 'new',         adults: 2, children: 0, totalPrice: 19000, source: 'online',    notes: '' },
  // ─── Стандарт 104 ───
  { id: uid(), roomId: 'r104', guestName: 'Волков Андрей Николаевич',        phone: '+7 (916) 200-30-40', email: 'volkov@mail.ru',    checkIn: '2026-04-23', checkOut: '2026-04-26', status: 'checked_in',  adults: 2, children: 0, totalPrice: 11400, source: 'ota',       notes: '' },
  { id: uid(), roomId: 'r104', guestName: 'Захарова Ольга Константиновна',   phone: '+7 (925) 600-70-80', email: 'zaharova@gmail.com',checkIn: '2026-05-01', checkOut: '2026-05-06', status: 'confirmed',   adults: 1, children: 0, totalPrice: 19000, source: 'direct',    notes: 'VIP гость' },
  // ─── Стандарт 105 ───
  { id: uid(), roomId: 'r105', guestName: 'Яковлева Светлана Борисовна',     phone: '+7 (916) 900-10-20', email: 'yakovleva@yandex.ru',checkIn: '2026-04-19', checkOut: '2026-04-24', status: 'checked_out', adults: 2, children: 2, totalPrice: 19000, source: 'online',    notes: '' },
  { id: uid(), roomId: 'r105', guestName: 'Белов Сергей Михайлович',         phone: '+7 (903) 111-33-55', email: 'belov@mail.ru',     checkIn: '2026-04-26', checkOut: '2026-05-02', status: 'confirmed',   adults: 2, children: 0, totalPrice: 22800, source: 'phone',     notes: '' },
  // ─── Стандарт 106 ───
  { id: uid(), roomId: 'r106', guestName: 'Михайлов Евгений Олегович',       phone: '+7 (977) 444-22-11', email: 'mikhailov@bk.ru',   checkIn: '2026-04-21', checkOut: '2026-04-28', status: 'checked_in',  adults: 1, children: 0, totalPrice: 26600, source: 'direct',    notes: '' },
  // ─── Стандарт 107 ───
  { id: uid(), roomId: 'r107', guestName: 'Федотова Ирина Вячеславовна',     phone: '+7 (916) 567-89-01', email: 'fedotova@mail.ru',  checkIn: '2026-04-24', checkOut: '2026-04-29', status: 'confirmed',   adults: 2, children: 0, totalPrice: 19000, source: 'corporate', notes: '' },
  // ─── Делюкс 201 ───
  { id: uid(), roomId: 'r201', guestName: 'Орлова Татьяна Владимировна',     phone: '+7 (925) 234-56-78', email: 'orlova@gmail.com',  checkIn: '2026-04-20', checkOut: '2026-04-27', status: 'checked_in',  adults: 2, children: 0, totalPrice: 41300, source: 'direct',    notes: 'Годовщина свадьбы, цветы в номер' },
  { id: uid(), roomId: 'r201', guestName: 'Данилов Кирилл Семёнович',        phone: '+7 (999) 876-54-32', email: 'danilov@yandex.ru', checkIn: '2026-04-30', checkOut: '2026-05-07', status: 'confirmed',   adults: 2, children: 0, totalPrice: 41300, source: 'ota',       notes: '' },
  // ─── Делюкс 202 ───
  { id: uid(), roomId: 'r202', guestName: 'Тихонов Максим Романович',        phone: '+7 (916) 432-10-98', email: 'tikhonov@mail.ru',  checkIn: '2026-04-22', checkOut: '2026-04-25', status: 'checked_in',  adults: 1, children: 0, totalPrice: 17700, source: 'phone',     notes: '' },
  { id: uid(), roomId: 'r202', guestName: 'Рыжова Нина Геннадьевна',         phone: '+7 (903) 543-21-09', email: 'ryzhova@gmail.com', checkIn: '2026-04-27', checkOut: '2026-05-01', status: 'new',         adults: 2, children: 0, totalPrice: 23600, source: 'online',    notes: '' },
  // ─── Делюкс 203 ───
  { id: uid(), roomId: 'r203', guestName: 'Громов Павел Денисович',          phone: '+7 (977) 111-22-44', email: 'gromov@bk.ru',      checkIn: '2026-04-23', checkOut: '2026-04-30', status: 'checked_in',  adults: 2, children: 1, totalPrice: 41300, source: 'direct',    notes: '' },
  // ─── Делюкс 204 ───
  { id: uid(), roomId: 'r204', guestName: 'Зайцева Валерия Эдуардовна',      phone: '+7 (916) 765-43-21', email: 'zaitseva@mail.ru',  checkIn: '2026-04-21', checkOut: '2026-04-24', status: 'checked_out', adults: 1, children: 0, totalPrice: 17700, source: 'ota',       notes: '' },
  { id: uid(), roomId: 'r204', guestName: 'Кузнецов Артём Витальевич',       phone: '+7 (925) 987-65-43', email: 'kuznetsov@yandex.ru',checkIn: '2026-04-25', checkOut: '2026-05-02', status: 'confirmed',   adults: 2, children: 0, totalPrice: 41300, source: 'corporate', notes: 'Оплата картой компании' },
  // ─── Делюкс 205 ───
  { id: uid(), roomId: 'r205', guestName: 'Фёдоров Никита Анатольевич',      phone: '+7 (999) 321-09-87', email: 'fedorov@gmail.com', checkIn: '2026-04-26', checkOut: '2026-04-30', status: 'new',         adults: 2, children: 0, totalPrice: 23600, source: 'direct',    notes: '' },
  // ─── Делюкс 206 ───
  { id: uid(), roomId: 'r206', guestName: 'Степанов Юрий Борисович',         phone: '+7 (916) 654-32-10', email: 'stepanov@mail.ru',  checkIn: '2026-04-23', checkOut: '2026-04-28', status: 'checked_in',  adults: 2, children: 0, totalPrice: 29500, source: 'phone',     notes: '' },
  // ─── Полулюкс 301 ───
  { id: uid(), roomId: 'r301', guestName: 'Лебедев Антон Игоревич',          phone: '+7 (925) 888-77-66', email: 'lebedev@bk.ru',     checkIn: '2026-04-20', checkOut: '2026-04-26', status: 'checked_in',  adults: 2, children: 0, totalPrice: 51000, source: 'direct',    notes: 'Завтрак включён' },
  { id: uid(), roomId: 'r301', guestName: 'Ильина Дарья Станиславовна',      phone: '+7 (903) 222-11-33', email: 'ilyina@yandex.ru',  checkIn: '2026-04-28', checkOut: '2026-05-04', status: 'confirmed',   adults: 2, children: 0, totalPrice: 51000, source: 'ota',       notes: '' },
  // ─── Полулюкс 302 ───
  { id: uid(), roomId: 'r302', guestName: 'Соловьёв Геннадий Фёдорович',     phone: '+7 (977) 333-44-55', email: 'soloviev@gmail.com',checkIn: '2026-04-22', checkOut: '2026-04-27', status: 'checked_in',  adults: 1, children: 0, totalPrice: 42500, source: 'phone',     notes: '' },
  // ─── Полулюкс 303 ───
  { id: uid(), roomId: 'r303', guestName: 'Баранова Елена Юрьевна',          phone: '+7 (916) 100-200-3', email: 'baranova@mail.ru',  checkIn: '2026-04-25', checkOut: '2026-04-29', status: 'confirmed',   adults: 2, children: 0, totalPrice: 34000, source: 'direct',    notes: '' },
  // ─── Полулюкс 304 ───
  { id: uid(), roomId: 'r304', guestName: 'Попова Людмила Викторовна',        phone: '+7 (925) 400-500-6', email: 'popova@bk.ru',      checkIn: '2026-04-23', checkOut: '2026-04-30', status: 'checked_in',  adults: 2, children: 1, totalPrice: 59500, source: 'corporate', notes: '' },
  // ─── Люкс 401 ───
  { id: uid(), roomId: 'r401', guestName: 'Макаров Роман Алексеевич',        phone: '+7 (999) 700-800-9', email: 'makarov@gmail.com', checkIn: '2026-04-21', checkOut: '2026-04-28', status: 'checked_in',  adults: 2, children: 0, totalPrice: 91000, source: 'direct',    notes: 'VIP. Шампанское при заселении' },
  { id: uid(), roomId: 'r401', guestName: 'Серова Анастасия Николаевна',     phone: '+7 (916) 900-800-7', email: 'serova@yandex.ru',  checkIn: '2026-04-30', checkOut: '2026-05-05', status: 'confirmed',   adults: 2, children: 0, totalPrice: 65000, source: 'online',    notes: '' },
  // ─── Люкс 402 ───
  { id: uid(), roomId: 'r402', guestName: 'Виноградов Сергей Павлович',      phone: '+7 (903) 600-500-4', email: 'vinogradov@mail.ru',checkIn: '2026-04-24', checkOut: '2026-04-27', status: 'no_show',     adults: 2, children: 0, totalPrice: 39000, source: 'ota',       notes: 'Не явился, предоплата удержана' },
  // ─── Люкс 403 ───
  { id: uid(), roomId: 'r403', guestName: 'Алексеев Вадим Олегович',        phone: '+7 (977) 123-456-7', email: 'alekseev@bk.ru',    checkIn: '2026-04-22', checkOut: '2026-04-29', status: 'checked_in',  adults: 2, children: 0, totalPrice: 91000, source: 'phone',     notes: 'Доп. завтрак в номер' },
  { id: uid(), roomId: 'r403', guestName: 'Николаева Юлия Андреевна',       phone: '+7 (916) 321-654-0', email: 'nikolaeva@gmail.com',checkIn: '2026-05-01', checkOut: '2026-05-08', status: 'new',         adults: 2, children: 0, totalPrice: 91000, source: 'direct',    notes: '' },
];

export const mockTariffs = [
  { id: 't1', name: 'Стандартный',    categoryId: 'cat-std',  price: 3800,  minStay: 1, days: [0,1,2,3,4,5,6], active: true,  description: '' },
  { id: 't2', name: 'С завтраком',    categoryId: 'cat-std',  price: 4500,  minStay: 1, days: [0,1,2,3,4,5,6], active: true,  description: 'Включён завтрак' },
  { id: 't3', name: 'Стандартный',    categoryId: 'cat-dlx',  price: 5900,  minStay: 1, days: [0,1,2,3,4,5,6], active: true,  description: '' },
  { id: 't4', name: 'С завтраком',    categoryId: 'cat-dlx',  price: 6800,  minStay: 1, days: [0,1,2,3,4,5,6], active: true,  description: 'Включён завтрак' },
  { id: 't5', name: 'Стандартный',    categoryId: 'cat-semi', price: 8500,  minStay: 1, days: [0,1,2,3,4,5,6], active: true,  description: '' },
  { id: 't6', name: 'Стандартный',    categoryId: 'cat-lux',  price: 13000, minStay: 2, days: [0,1,2,3,4,5,6], active: true,  description: 'Мин. 2 ночи' },
  { id: 't7', name: 'Выходного дня',  categoryId: 'cat-std',  price: 4200,  minStay: 2, days: [5,6],           active: true,  description: 'Только выходные' },
];
