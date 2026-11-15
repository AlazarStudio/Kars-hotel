export const priceBasisText = {
  ru: {
    title: 'Как определены цены',
    class: { label: 'По классу', description: 'Авия подобрала цену по классу номера. Это не отдельная цена этой категории в договоре.' },
    'default-class': { label: 'Из «Стандарта»', description: 'Авия использовала цену класса «Стандарт» как замену. Это не отдельная цена этой категории в договоре.' },
    kind: { label: 'По виду', description: 'Авия подобрала цену по виду размещения. Это не отдельная цена этой категории в договоре.' },
    unknown: 'Для части цен основание ещё не передано. Попросите диспетчера обновить договорные цены в Авии.',
  },
  en: {
    title: 'How prices were selected',
    class: { label: 'By room class', description: 'Avia selected this price by room class. It is not a separate contract price for this room category.' },
    'default-class': { label: 'From Standard', description: 'Avia used the Standard room class price as a fallback. It is not a separate contract price for this room category.' },
    kind: { label: 'By stay type', description: 'Avia selected this price by accommodation type. It is not a separate contract price for this room category.' },
    unknown: 'The source of some prices has not been provided yet. Ask the dispatcher to refresh contract prices in Avia.',
  },
  tr: {
    title: 'Fiyatlar nasıl seçildi',
    class: { label: 'Oda sınıfına göre', description: 'Avia bu fiyatı oda sınıfına göre seçti. Bu oda kategorisine özel bir sözleşme fiyatı değildir.' },
    'default-class': { label: 'Standart sınıftan', description: 'Avia, Standart oda sınıfının fiyatını alternatif olarak kullandı. Bu oda kategorisine özel bir sözleşme fiyatı değildir.' },
    kind: { label: 'Konaklama türüne göre', description: 'Avia bu fiyatı konaklama türüne göre seçti. Bu oda kategorisine özel bir sözleşme fiyatı değildir.' },
    unknown: 'Bazı fiyatların kaynağı henüz iletilmedi. Operatörden Avia sözleşme fiyatlarını güncellemesini isteyin.',
  },
};
