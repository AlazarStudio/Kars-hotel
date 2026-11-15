import { useEffect, useId, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import classes from './Tariffs.module.css';
import Select from '../../shared/Select';
import PriceBasis, { PriceBasisLegend } from './PriceBasis';
import { useContractPrices, useContractPreview } from '../../../../hooks/api/useContracts';
import { periodOn, priceKey, occupancyLabel, contractViewKey, PRICE_REASON } from './corporateTariff';

const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const fmtDay = (d) => d ? format(parseISO(String(d).slice(0, 10)), 'dd.MM.yyyy') : '—';

export function ContractPriceNotice({ title, children, onRetry }) {
  return <div className={classes.contractNotice} role={onRetry ? 'alert' : 'status'}>
    <strong>{title}</strong>
    {children && <div>{children}</div>}
    {onRetry && <button className={classes.btnGhost} onClick={onRetry}>Повторить загрузку</button>}
  </div>;
}

export default function ContractPricesTab({ plan }) {
  return <ContractPriceReader plan={plan} />;
}

export function ContractTariffPreview({ form, onStateChange }) {
  const conditions = useMemo(() => ({
    partnerId: form.partnerId,
    operatorContract: form.operatorContract.trim(),
    partnerAccountId: form.partnerAccountId || undefined,
    partnerCustomerId: form.partnerCustomerId || undefined,
    guestKind: form.guestKind || undefined,
    mealPlan: form.mealPlan,
  }), [form.partnerId, form.operatorContract, form.partnerAccountId, form.partnerCustomerId, form.guestKind, form.mealPlan]);
  return <ContractPriceReader conditions={conditions} onStateChange={onStateChange} />;
}

/** Один экран для сохранённого тарифа и проверки мастера; цену всегда считает сервер. */
function ContractPriceReader({ plan, conditions, onStateChange }) {
  const periodId = useId();
  const [period, setPeriod] = useState(null);
  const saved = useContractPrices(plan?.id, period ?? undefined, period ?? undefined, !!plan, plan ? contractViewKey(plan) : null);
  const preview = useContractPreview(conditions, period ?? undefined, period ?? undefined, !!conditions);
  const query = conditions ? preview : saved;
  const { data, isLoading, isError, isFetching, refetch } = query;
  useEffect(() => {
    onStateChange?.({ loading: isLoading || !data, error: isError || data?.hasSlice === false || !!data?.unknownCustomer });
  }, [onStateChange, isLoading, isError, data]);
  useEffect(() => {
    if (!data?.today || !data.periods.length) return;
    if (period === null || !data.periods.includes(period)) setPeriod(periodOn(data.periods, data.today));
  }, [data, period]);

  if (isLoading) return <div className={classes.sectionHint} role="status">Загрузка цен договора…</div>;
  if (isError) return <ContractPriceNotice title="Не удалось проверить цены договора" onRetry={() => refetch()}>
    Попробуйте ещё раз, чтобы увидеть актуальные цены.
  </ContractPriceNotice>;
  if (!plan?.operatorContract && !conditions?.operatorContract) return <ContractPriceNotice title="Выберите договор">
    Откройте редактирование тарифа и укажите договор партнёра.
  </ContractPriceNotice>;
  if (!data) return null;
  if (data.unknownCustomer || data.hasSlice === false) return <ContractPriceNotice title="Условия требуют проверки">
    Юрлицо или авиакомпания не найдены в справочнике партнёра. Попросите диспетчера обновить справочник.
  </ContractPriceNotice>;

  const night = data.nights?.[0];
  const reason = PRICE_REASON[night?.reason];
  if (!data.periods.length) return <ContractPriceNotice title="Ждёт цен по договору">
    {reason ?? 'Готовой сетки цен ещё нет. Попросите диспетчера обновить договор.'}
    {conditions && <p>Тариф можно создать заранее. Он начнёт применяться, когда придут цены для выбранных условий.</p>}
  </ContractPriceNotice>;

  const shown = period ?? periodOn(data.periods, data.today);
  const detail = data.periodDetails?.find((p) => p.from === shown);
  const categories = data.categories ?? [];
  const guests = Array.from({ length: Math.max(1, ...categories.map((c) => c.capacity ?? 1)) }, (_, i) => i + 1);
  const cellPrices = new Map((night?.prices ?? []).map((p) => [priceKey(p.categoryId, p.occupancy), p]));
  const uncovered = categories.filter((c) => !(night?.prices ?? []).some((p) => p.categoryId === c.categoryId));

  return <div className={classes.contractPriceContent}>
    <div className={classes.contractPricesHead}>
      <div className={classes.periodField}>
        <label htmlFor={periodId}>Период цен</label>
        <Select id={periodId} className={classes.input} value={shown} onChange={(e) => setPeriod(e.target.value)}>
          {data.periods.map((from) => {
            const doc = data.periodDetails?.find((p) => p.from === from);
            return <option key={from} value={from}>
              {(doc?.amendmentNumber ? 'ДС № ' + doc.amendmentNumber : 'Договор № ' + data.contractNumber) + ' · с ' + fmtDay(from) + (doc?.to ? ' по ' + fmtDay(doc.to) : '')}
            </option>;
          })}
        </Select>
      </div>
      {night?.prices?.length > 0 && <span className={classes.rowChip}>{data.vatRate != null ? 'НДС ' + Number(data.vatRate) + '%' : 'Без НДС'}</span>}
      {isFetching && <span className={classes.fieldHint} role="status">Обновление…</span>}
    </div>
    <div className={classes.priceContext}>
      Цена за номер за ночь · в рублях · по числу гостей
      {detail && <span>Действует с {fmtDay(detail.from)}{detail.to ? ' по ' + fmtDay(detail.to) : ' без указанной даты окончания'}</span>}
    </div>
    {reason && <ContractPriceNotice title={reason}>
      {night?.reason === 'OUTSIDE_CONTRACT' ? 'Выберите другой период или проверьте даты в календаре.' : 'Проверьте условия тарифа или попросите диспетчера дополнить цены.'}
    </ContractPriceNotice>}
    {categories.length === 0 ? <ContractPriceNotice title="Нет категорий номеров">Создайте категории в разделе «Номера».</ContractPriceNotice> : <>
      <div className={classes.contractTableScroll}>
        <table className={classes.contractTable} style={{ minWidth: 260 + guests.length * 100 }}>
          <caption className={classes.srOnly}>Цены договора {data.contractNumber} с {fmtDay(shown)}</caption>
          <thead><tr><th scope="col">Категория номера</th>{guests.map((g) => <th scope="col" key={g}>На {occupancyLabel(g)}</th>)}</tr></thead>
          <tbody>{categories.map((cat) => <tr key={cat.categoryId}>
            <th scope="row"><div className={classes.stdName}>{cat.name}</div><div className={classes.stdMeta}>до {cat.capacity ?? 1} чел.</div></th>
            {guests.map((g) => {
              const capacity = cat.capacity ?? 1;
              const cell = cellPrices.get(priceKey(cat.categoryId, g));
              const price = cell?.price;
              const missing = night?.missing?.find((m) => m.categoryId === cat.categoryId && m.occupancy === g);
              const hint = g > capacity ? 'Превышает вместимость категории' : reason ?? PRICE_REASON[missing?.reason] ?? 'Нет цены в договоре';
              return <td key={g} className={g > capacity ? classes.cellUnavailable : undefined} title={price == null ? hint : undefined}>
                {g <= capacity && price != null ? <div className={classes.contractPriceValue}>
                  <span className={classes.money}>{fmtRub(price)} ₽</span><PriceBasis basis={cell.basis} />
                </div> : <span aria-label={hint}>—</span>}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <PriceBasisLegend prices={night?.prices} />
      {uncovered.length > 0 && <div className={classes.coverageNote}>
        <strong>Нет цены для категорий:</strong> {uncovered.map((c) => c.name).join(', ')}.
        <span>Для этих категорий тариф не предлагается. Прочерк в отдельной колонке означает отсутствие цены на это число гостей.</span>
      </div>}
    </>}
  </div>;
}
