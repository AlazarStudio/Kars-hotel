import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import Select from '../../shared/Select';
import { useContractPrices } from '../../../../hooks/api/useContracts';
import { periodOn } from './corporateTariff';

/**
 * «Цены договора» — единственное, что видит гостиница у корпоративного тарифа
 * по деньгам. Ввода здесь нет и быть не может: цены ведёт реестр договоров
 * Авии, а ПМС берёт их оттуда.
 */

const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const fmtDay = (d) =>
  d ? format(parseISO(String(d).slice(0, 10)), 'd MMM yyyy', { locale: ru }) : '—';
const occLabel = (n) => (n === 1 ? '1 гость' : n + ' гостя');

export default function ContractPricesTab({ plan }) {
  const [period, setPeriod] = useState(null);
  const { data, isLoading, isError } = useContractPrices(plan.id, period ?? undefined, period ?? undefined);

  /* Пока период не выбран, сервер отдаёт сегодняшний день, а подпись селектора
     берётся у первой ДС — таблица показывала бы одну сетку под подписью
     другой. Выбираем ДС, которая действует на сегодня, и запрашиваем её день. */
  const periods = data?.periods;
  useEffect(() => {
    if (period !== null) return;
    setPeriod(periodOn(periods, new Date().toISOString().slice(0, 10)));
  }, [periods, period]);

  const cellPrice = useMemo(() => {
    const map = new Map();
    for (const c of data?.nights?.[0]?.prices ?? []) {
      map.set(c.categoryId + '|' + c.occupancy, c.price);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return <div className={classes.sectionHint}>Загрузка цен договора…</div>;
  }
  if (isError) {
    return (
      <div className={classes.emptyHint}>
        Не удалось загрузить цены договора — попробуйте обновить страницу.
      </div>
    );
  }
  /* Без договора нечего считать: без этой ветки экран говорил бы «Авиа не
     прислала приложение», хотя договор просто не выбран. */
  if (!plan.operatorContract) {
    return (
      <div className={classes.emptyHint}>
        У тарифа не указан договор — откройте его кнопкой с карандашом и
        выберите договор. Без договора цену посчитать нечем.
      </div>
    );
  }
  if (data?.unknownCustomer) {
    return (
      <div className={classes.emptyHint}>
        Авиакомпания этого тарифа не найдена в справочнике партнёра — посчитать
        нечем. Обратитесь к диспетчеру Kars Avia.
      </div>
    );
  }
  /* Срез есть, а сеток нет — это другой случай, чем «среза нет»: иначе оба
     печатали бы одну и ту же фразу про неприсланное приложение. */
  if (data && data.hasSlice === false) {
    return (
      <div className={classes.emptyHint}>
        Тариф не сходится с договором: юрлицо или авиакомпания не найдены в
        справочнике партнёра или выключены. Попросите диспетчера Kars Avia
        проверить справочник.
      </div>
    );
  }
  if (!data?.periods?.length) {
    return (
      <div className={classes.emptyHint}>
        Цен по договору {data?.contractNumber ?? ''} ещё нет — Авиа не прислала
        ценовое приложение. Когда пришлёт, тариф заработает сам.
      </div>
    );
  }

  const shown = period ?? data.periods[0];
  const categories = data.categories ?? [];
  const maxCapacity = Math.max(1, ...categories.map((c) => c.capacity ?? 1));
  const guests = Array.from({ length: maxCapacity }, (_, i) => i + 1);

  return (
    <div>
      <div className={classes.sectionHint}>
        Так вас посчитает партнёр. Цены ведутся в его реестре договоров и здесь
        только показываются; в тарифе их не вводят.
      </div>

      <div className={classes.contractPricesHead}>
        <Select
          className={classes.contractPeriodSelect}
          value={shown}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {data.periods.map((p) => (
            <option key={p} value={p}>
              {'Действует с ' + fmtDay(p)}
            </option>
          ))}
        </Select>
        {data.vatRate != null ? (
          <span className={classes.rowChip}>{'НДС ' + Number(data.vatRate) + '%'}</span>
        ) : (
          <span className={classes.rowChip}>без НДС</span>
        )}
      </div>

      <table className={classes.contractTable}>
        <thead>
          <tr>
            <th>Категория</th>
            {guests.map((o) => (
              <th key={o}>{occLabel(o)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.categoryId}>
              <td>
                <div className={classes.stdName}>{cat.name}</div>
                <div className={classes.stdMeta}>до {cat.capacity ?? '?'} чел.</div>
              </td>
              {guests.map((o) => {
                const price =
                  o <= (cat.capacity ?? 1)
                    ? cellPrice.get(cat.categoryId + '|' + o)
                    : null;
                return (
                  <td key={o}>
                    {price != null ? (
                      fmtRub(price) + ' ₽'
                    ) : (
                      <span className={classes.calNoPrice}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {data.nights?.[0] && data.nights[0].day !== shown ? (
        <div className={classes.fieldHint}>
          Цены показаны на {fmtDay(data.nights[0].day)} — ближайший день периода,
          за который в договоре есть цифры.
        </div>
      ) : null}
    </div>
  );
}
