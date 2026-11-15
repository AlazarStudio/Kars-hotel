import React, { useState, useMemo, useRef, useEffect, useId, useLayoutEffect } from 'react';
import {
  format, startOfMonth,
  addDays, subDays, parseISO,
  getMonth, getYear, setMonth, setYear,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import { useRatePlans, useTariffRoomTypes, useCreateRatePlan, useUpdateRatePlan, useDeleteRatePlan } from '../../../../hooks/api/useRatePlans';
import {
  useRates, useBulkUpsertRates, useFillRates,
  useStandardRates, useSetStandardRates,
  useSeasons, useReplaceSeasons,
} from '../../../../hooks/api/useRates';
import { useContracts } from '../../../../hooks/api/useContracts';
import { usePartners } from '../../../../hooks/api/usePartners';
import { useAuth } from '../../../../auth/AuthContext';
import {
  GUEST_KIND_LABELS, GUEST_KIND_SHORT, MEAL_PLAN_SHORT,
  occupancyColumns, occupancyLabel, priceKey, pickOccupancy, partnerConditions,
  planForSlice,
  sliceOptions, reconcileSlice, contractViewKey, contractAvailabilityText,
} from './corporateTariff';
import { saveWizardSteps } from './tariffWizard';
import NumberInput from '../../shared/NumberInput.jsx';
import Select from '../../shared/Select';
import DateInput from '../../shared/DateInput';
import WizardSteps from '../../shared/WizardSteps.jsx';
import ContractPricesTab, { ContractTariffPreview, ContractPriceNotice } from './ContractPricesTab';
import ContractCalendar from './ContractCalendar';
import DialogLayer from '../../shared/DialogLayer';
import ConfirmDialog from '../../shared/ConfirmDialog';
import useModalCloseGuard from '../../shared/useModalCloseGuard';

/* 5.3 · подписи — без латинских аббревиатур: гостиница читает «что
   входит», а не код канала продаж. */
const MEAL_PLAN_LABELS = {
  NONE: 'Без питания',
  BB: 'Завтрак',
  HB: 'Полупансион: завтрак и ужин',
  FB: 'Полный пансион: завтрак, обед и ужин',
  AI: 'Всё включено',
};

/* Какие приёмы пищи входят в вариант — то же правило, что у сервера
   (`rate-plans/meal-terms.ts`). */
const MEAL_PLAN_MEALS = {
  NONE: [],
  BB: ['breakfast'],
  HB: ['breakfast', 'dinner'],
  FB: ['breakfast', 'lunch', 'dinner'],
  AI: ['breakfast', 'lunch', 'dinner'],
};
const MEAL_NAMES = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин' };
const MEAL_PRICE_KEY = { breakfast: 'mealPriceBreakfast', lunch: 'mealPriceLunch', dinner: 'mealPriceDinner' };

/* 5.3 · что уходит на сервер о питании: в цене номера — цен нет; за сутки —
   только сумма за сутки; по приёмам — только входящие в вариант. */
function mealPayload(form) {
  const meals = MEAL_PLAN_MEALS[form.mealPlan] ?? [];
  const included = meals.length === 0 || form.mealIncluded;
  const perDay = !included && form.mealPerDayMode;
  const per = (m) => (!included && !perDay && meals.includes(m) ? form[MEAL_PRICE_KEY[m]] ?? null : null);
  return {
    mealIncluded: included,
    mealPriceBreakfast: per('breakfast'),
    mealPriceLunch: per('lunch'),
    mealPriceDinner: per('dinner'),
    mealPricePerDay: perDay ? form.mealPricePerDay ?? null : null,
    allInclusiveNote: form.mealPlan === 'AI' ? (form.allInclusiveNote || null) : null,
  };
}

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const SEASON_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Calendar geometry (mirrors the шахматка rolling-window layout).
const CAL_LABEL_W = 168;
const CAL_DAY_MIN = 46;
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

const codeFromName = (name) =>
  !name.trim() ? '' : name.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '').slice(0, 32) || 'PLAN';

const formSignature = (form) => JSON.stringify(Object.fromEntries(Object.entries(form).filter(([key]) => !['id', '_autoCode'].includes(key))));

const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const fmtDay = (d) => (d ? format(parseISO(String(d).slice(0, 10)), 'dd.MM.yyyy') : '—');
const day10 = (s) => (typeof s === 'string' ? s.slice(0, 10) : format(s, 'yyyy-MM-dd'));

// ─────────────────────────────────────────────────────────────────────────────
// Baseline resolver — mirrors backend: covering season → standard price → null.
// Built from the standard prices + seasons loaded for the current plan.
// ─────────────────────────────────────────────────────────────────────────────
function buildResolver(standardRates, seasons) {
  const stdByRt = {};
  standardRates.forEach((s) => { stdByRt[s.roomTypeId] = String(s.price); });

  const seasonsByRt = {};
  seasons.forEach((s) => {
    (seasonsByRt[s.roomTypeId] ||= []).push({
      from: day10(s.dateFrom),
      to: day10(s.dateTo),
      price: String(s.price),
      name: s.name,
      color: s.color,
      sortOrder: s.sortOrder ?? 0,
    });
  });
  // Most-specific first: latest start date, then higher sortOrder.
  Object.values(seasonsByRt).forEach((arr) =>
    arr.sort((a, b) => (a.from !== b.from ? (a.from < b.from ? 1 : -1) : b.sortOrder - a.sortOrder)),
  );

  return (rtId, day) => {
    for (const s of seasonsByRt[rtId] || []) {
      if (day >= s.from && day <= s.to) return { price: s.price, source: 'season', season: s };
    }
    if (rtId in stdByRt) return { price: stdByRt[rtId], source: 'standard' };
    return null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RatePlanForm modal
// ─────────────────────────────────────────────────────────────────────────────
/* 5.2 · Новый тариф — мастером: у своего тарифа свои шаги, у договорного свои.
   Шаги — те же экраны, что вкладки тарифа: правило одно, и что заполнено в
   мастере, то и видно на вкладке. */
const STEPS_OWN = ['Для кого', 'Питание', 'Цены', 'Сезоны', 'Проверка'];
const STEPS_CORP = ['Для кого', 'Договор', 'Срез', 'Проверка'];
const HINTS_OWN = [
  'Назовите тариф и скажите, для кого он.',
  'Что входит в тариф и платит ли гость за питание отдельно.',
  'Одна цена за номер или своя цена на каждое число гостей.',
  'Необязательно: другие цены на отдельные даты. Можно пропустить.',
  'Проверьте тариф. «Готово» сохранит условия, цены и сезоны.',
];
const HINTS_CORP = [
  'Назовите тариф. Он будет считаться по договору партнёра.',
  'Выберите договор из реестра Kars Avia — цены придут из него.',
  'Для кого этот срез: юрлицо, авиакомпания, вид брони, питание.',
  'Проверьте цены, сроки и категории. Тариф без цен можно создать заранее.',
];

/* Питание корпоративного тарифа — только из договора: цена питания приходит
   из него же, и вариант, которого в договоре нет, никогда не посчитается.
   Поэтому при выборе договора берём его вариант, сохраняя уже выбранный,
   если он в договоре есть; договор без сеток оставляет выбор человеку. */
const contractMeals = (contract) => [...new Set((contract?.slices ?? []).map((s) => s.mealPlan))];
const mealForContract = (contract, preferred) => {
  const options = contractMeals(contract);
  if (!options.length) return preferred ?? 'NONE';
  return options.includes(preferred) ? preferred : options[0];
};

/* Проверка своего тарифа: он уже создан, цены и сезоны записаны своими
   кнопками на шагах выше. Говорим то же, что говорило второе окно мастера. */
function OwnTariffCheck({ plan, form }) {
  const { data: standard = [] } = useStandardRates(plan.id);
  const priced = standard.filter((s) => Number(s.price) > 0).length;
  return (
    <div className={classes.reviewSummary} style={{ gridColumn: '1/-1' }}>
      <div className={classes.reviewHeading}><div><span className={classes.reviewOverline}>Свой тариф гостиницы</span><h3>{form.name}</h3></div><code>{form.code}</code></div>
      <dl className={classes.reviewFacts}>
        <div><dt>Базовые цены</dt><dd>{priced > 0 ? `Задано: ${priced}` : 'Пока не заданы'}</dd></div>
        <div><dt>Питание</dt><dd>{MEAL_PLAN_LABELS[form.mealPlan] ?? form.mealPlan}</dd></div>
        <div><dt>Статус</dt><dd>{form.isActive ? 'Активен' : 'Неактивен'}</dd></div>
      </dl>
      {!priced && <div className={classes.fieldHint}>Тариф не продаётся, пока для него не заданы цены.</div>}
    </div>
  );
}

function RatePlanForm({ plan, prefill, allPlans, contracts, partners, roomTypes, onSave, onDelete, onClose, saving, error }) {
  const isNew = !plan?.id;
  /* Договор и срез приходят из блока «Цены по договору» уже выбранными.
     Названия среди них нет, а без него тариф не создать (сервер ждёт name и
     code), поэтому первый шаг мастера остаётся первым. */
  const [step, setStep] = useState(0);
  /* Свой тариф создаётся на втором шаге: без id не показать ни цены, ни
     сезоны, а второго окна больше нет. Созданный тариф живёт здесь. */
  const [created, setCreated] = useState(null);
  const [savingStep, setSavingStep] = useState(false);
  const [previewState, setPreviewState] = useState({ loading: true, error: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const pricesSave = useRef(null);
  const seasonsSave = useRef(null);
  const stepBody = useRef(null);
  const [form, setForm] = useState({
    /* id — чтобы «Готово» после создания своего тарифа дописывало его, а не
       заводило второй. */
    id: plan?.id ?? '',
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    mealPlan: mealForContract(
      prefill?.contract,
      prefill?.slice?.mealPlan ?? plan?.mealPlan,
    ),
    mealIncluded: plan?.mealIncluded ?? true,
    mealPerDayMode: plan?.mealPricePerDay != null,
    mealPriceBreakfast: plan?.mealPriceBreakfast ?? null,
    mealPriceLunch: plan?.mealPriceLunch ?? null,
    mealPriceDinner: plan?.mealPriceDinner ?? null,
    mealPricePerDay: plan?.mealPricePerDay ?? null,
    allInclusiveNote: plan?.allInclusiveNote ?? '',
    isActive: plan?.isActive ?? true,
    parentRatePlanId: plan?.parentRatePlanId ?? '',
    priceModifierType: plan?.priceModifierType ?? 'PERCENT',
    priceModifierValue: plan?.priceModifierValue ?? 0,
    forOperator: plan?.forOperator ?? Boolean(prefill),
    operatorContract: prefill?.contract?.number ?? plan?.operatorContract ?? '',
    partnerId: prefill?.contract?.partnerId ?? plan?.partnerId ?? '',
    partnerAccountId: prefill?.contract?.account
      ? (partners.find((p) => p.id === prefill.contract.partnerId)?.accounts ?? [])
          .find((a) => a.code === prefill.contract.account.code)?.id ?? ''
      : (plan?.partnerAccountId ?? ''),
    partnerCustomerId: prefill?.slice?.customer
      ? (partners.find((p) => p.id === prefill.contract.partnerId)?.customers ?? [])
          .find((c) => c.code === prefill.slice.customer)?.id ?? ''
      : (plan?.partnerCustomerId ?? ''),
    guestKind: prefill?.slice?.guestKind ?? plan?.guestKind ?? '',
    vatRate: plan?.vatRate != null ? String(Number(plan.vatRate)) : '',
    _autoCode: isNew,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleNameChange = (v) => {
    setForm(f => ({ ...f, name: v, code: f._autoCode ? codeFromName(v) : f.code }));
  };
  const handleCodeChange = (v) => {
    setForm(f => ({ ...f, code: v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''), _autoCode: false }));
  };

  const parentOptions = allPlans.filter(p => p.id !== plan?.id && !p.forOperator);
  /* Корпоративный тариф не наследуется: правка родителя меняла бы цены молча.
     Поэтому признак и базовый план — исключающие друг друга, и включение
     первого гасит второй прямо в форме, а не отказом сервера после
     «Сохранить». Условия корпоративного тарифа приходят из договора — при
     выключении гасим их вместе с признаком, чтобы в свой тариф не попали
     чужие. */
  const setCorporate = (on) =>
    setForm(f => ({
      ...f,
      forOperator: on,
      parentRatePlanId: on ? '' : f.parentRatePlanId,
      ...(on ? {} : {
        operatorContract: '', partnerId: '', partnerAccountId: '', partnerCustomerId: '', guestKind: '',
      }),
    }));

  const stepList = form.forOperator ? STEPS_CORP : STEPS_OWN;
  const hints = form.forOperator ? HINTS_CORP : HINTS_OWN;
  const chosenContract = contracts.find(
    (c) => c.number.trim() === form.operatorContract.trim() && (!form.partnerId || c.partnerId === form.partnerId),
  );
  const partner = partners.find((p) => p.id === form.partnerId);
  const options = sliceOptions(chosenContract, partner, form);
  const setSlice = (key, value) => setForm((f) => reconcileSlice(chosenContract, partner, { ...f, [key]: value }));
  const validSlice = !options.unresolvedAccount && !options.unresolvedCustomer &&
    (chosenContract?.account || form.partnerAccountId ? options.accounts.some((a) => a.id === form.partnerAccountId) : true) &&
    options.meals.includes(form.mealPlan) &&
    options.kinds.some((k) => (k ?? '') === (form.guestKind ?? '')) &&
    (options.anyCustomer || options.customers.some((c) => c.id === form.partnerCustomerId));
  const busy = saving || savingStep;
  const initialSignature = useRef(formSignature(form));
  const closeGuard = useModalCloseGuard({ onClose, busy,
    dirty: formSignature(form) !== initialSignature.current,
    force: (isNew && step > 0) || !!created,
    message: created ? 'Тариф уже создан: записанные цены и сезоны останутся. Несохранённые изменения будут потеряны. Вернуться к настройке можно из карточки тарифа.' : undefined,
  });
  useEffect(() => {
    setShowRequired(false);
    if (stepBody.current) stepBody.current.scrollTop = 0;
    if (step > 0) stepBody.current?.focus();
  }, [step]);

  const canNext =
    step === 0
      ? Boolean(form.name.trim().length >= 2 && /^[A-Z0-9_-]{2,32}$/.test(form.code))
      : form.forOperator && step === 1
        ? Boolean(chosenContract && form.partnerId)
        : form.forOperator && step === 2
          ? validSlice
          : true;

  /* Договор корпоративному тарифу нужен и на последнем шаге, и в правке: без
     него цены брать неоткуда. */
  const canFinish = canNext && (!form.forOperator || (chosenContract && validSlice &&
    (!isNew || (!previewState.loading && !previewState.error))));

  /* В правке шаг один, как было: степпера нет, все поля сразу. */
  const finalStep = isNew ? stepList.length - 1 : 0;
  const at = (n) => !isNew || step === n;
  /* «Цены» и «Сезоны» — те же экраны, что вкладки тарифа, и им нужна ширина
     прежнего окна мастера: иначе сетка по числу гостей уезжает под край. */
  const priceStep = Boolean(!form.forOperator && created && (step === 2 || step === 3));
  const wideStep = priceStep || (form.forOperator && step === 3);
  const requiredHint = step === 0 ? 'Введите название от 2 символов и код от 2 до 32 латинских букв, цифр, «_» или «-».'
    : step === 1 ? 'Выберите договор партнёра.' : 'Выберите совместимые условия тарифа. Если справочник неполный, попросите диспетчера обновить его.';
  const saveSteps = (steps, savePlan) => saveWizardSteps(steps.map((stepIndex) => ({
    step: stepIndex,
    save: () => (stepIndex === 2 ? pricesSave : seasonsSave).current?.() ?? false,
  })), savePlan);

  return (
    <>
      <DialogLayer onClose={closeGuard.requestClose} busy={busy}
        backdropClassName={classes.overlay} className={`${classes.modal} ${classes.wizardModal}`}
        labelledBy="tariff-form-title" style={wideStep ? { maxWidth: 1040 } : undefined}>
        <div className={classes.modalHeader}>
          <div>
            <div className={classes.modalEyebrow}>Тарифы гостиницы</div>
            <h2 className={classes.modalTitle} id="tariff-form-title">{isNew ? 'Новый тариф' : 'Редактировать тариф'}</h2>
            <div className={classes.modalSubtitle}>{form.forOperator ? 'Размещение по условиям договора партнёра' : 'Собственные цены и сезонные предложения'}</div>
          </div>
          <button className={classes.closeBtn} disabled={busy} aria-label="Закрыть мастер" onClick={closeGuard.requestClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>
        {isNew && <WizardSteps steps={stepList} current={step} hint={hints[step]} />}

        <div className={classes.wizardBody} ref={stepBody} tabIndex={-1} aria-label={isNew ? stepList[step] : 'Условия тарифа'}>
        <fieldset className={classes.wizardFields} disabled={busy}>
        {!priceStep && (
        <div className={`${classes.formGrid} ${form.forOperator && step === 3 ? classes.reviewGrid : ''}`}>
          {at(0) && (<>
          <fieldset className={classes.typeChoice}>
            <legend>Источник цен</legend>
            <label className={!form.forOperator ? classes.typeChoiceActive : undefined}>
              <input type="radio" name="tariff-type" checked={!form.forOperator} disabled={Boolean(created)} onChange={() => setCorporate(false)} />
              <strong>Свой тариф</strong><span>Цены и сезоны задаёт гостиница</span>
            </label>
            <label className={form.forOperator ? classes.typeChoiceActive : undefined}>
              <input type="radio" name="tariff-type" checked={form.forOperator} disabled={Boolean(created)} onChange={() => setCorporate(true)} />
              <strong>По договору партнёра</strong><span>Цены, питание и НДС — из реестра</span>
            </label>
          </fieldset>
          <div className={classes.formGroup}>
              <label htmlFor="tariff-name">Название *</label>
            <input
              className={classes.input}
              id="tariff-name"
              name="tariffName" autoComplete="off" spellCheck={false} data-autofocus=""
              aria-invalid={showRequired && form.name.trim().length < 2}
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="Стандартный тариф"
            />
          </div>
          <div className={classes.formGroup}>
            <label htmlFor="tariff-code">Код *</label>
            <input
              className={classes.input}
              id="tariff-code"
              name="tariffCode" autoComplete="off" spellCheck={false}
              aria-invalid={showRequired && !/^[A-Z0-9_-]{2,32}$/.test(form.code)}
              value={form.code}
              onChange={e => handleCodeChange(e.target.value)}
              placeholder="STANDARD"
              style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}
            />
            <div className={classes.fieldHint}>Уникальный код тарифа — латинские буквы и цифры</div>
          </div>
          </>)}

          {/* 5.3 · питание и его цена — только у своего тарифа: у договорного
              питание задано срезом договора, а цена приходит из договора. */}
          {!form.forOperator && at(1) && (<>
          <div className={classes.formGroup}>
            <label>Питание</label>
            <Select className={classes.input} value={form.mealPlan} onChange={e => set('mealPlan', e.target.value)}>
              {Object.entries(MEAL_PLAN_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
          {/* 5.3 · у варианта с питанием — как оно оплачивается. */}
          {form.mealPlan !== 'NONE' && (
            <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.mealIncluded}
                  onChange={e => set('mealIncluded', e.target.checked)}
                />{' '}
                Питание включено в цену номера
              </label>
              {!form.mealIncluded && (
                <>
                  <label style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={form.mealPerDayMode}
                      onChange={e => set('mealPerDayMode', e.target.checked)}
                    />{' '}
                    Одной суммой за сутки
                  </label>
                  {form.mealPerDayMode ? (
                    <div style={{ marginTop: 8 }}>
                      <label>За сутки на гостя, ₽</label>
                      <NumberInput
                        className={classes.input}
                        decimal={false}
                        min="0"
                        value={form.mealPricePerDay}
                        onChange={(v) => set('mealPricePerDay', v)}
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                      {(MEAL_PLAN_MEALS[form.mealPlan] ?? []).map((m) => (
                        <div key={m}>
                          <label>{MEAL_NAMES[m]} на гостя, ₽</label>
                          <NumberInput
                            className={classes.input}
                            decimal={false}
                            min="0"
                            value={form[MEAL_PRICE_KEY[m]]}
                            onChange={(v) => set(MEAL_PRICE_KEY[m], v)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {form.mealPlan === 'AI' && (
                <div style={{ marginTop: 8 }}>
                  <label>Что входит во «всё включено»</label>
                  <input
                    className={classes.input}
                    value={form.allInclusiveNote}
                    maxLength={500}
                    onChange={e => set('allInclusiveNote', e.target.value)}
                    placeholder="Например: трёхразовое питание, напитки в баре до 23:00"
                  />
                </div>
              )}
            </div>
          )}
          </>)}

          {at(0) && (<>
          <div className={classes.formGroup}>
            <label>Статус</label>
            <Select className={classes.input} value={form.isActive ? 'active' : 'inactive'} onChange={e => set('isActive', e.target.value === 'active')}>
              <option value="active">Активен</option>
              <option value="inactive">Неактивен</option>
            </Select>
          </div>

          {!form.forOperator && parentOptions.length > 0 && (
            <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Базовый план (наследование цен)</label>
              <Select className={classes.input} value={form.parentRatePlanId} onChange={e => set('parentRatePlanId', e.target.value)}>
                <option value="">— Нет (независимый план) —</option>
                {parentOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </Select>
            </div>
          )}

          {!form.forOperator && form.parentRatePlanId && (
            <>
              <div className={classes.formGroup}>
                <label>Тип модификатора</label>
                <Select className={classes.input} value={form.priceModifierType} onChange={e => set('priceModifierType', e.target.value)}>
                  <option value="PERCENT">Процент (%)</option>
                  <option value="ABSOLUTE">Фиксированная сумма (₽)</option>
                </Select>
              </div>
              <div className={classes.formGroup}>
                <label>
                  Значение {form.priceModifierType === 'PERCENT' ? '(−10 = скидка 10%)' : '(₽, −500 = скидка 500 ₽)'}
                </label>
                <NumberInput allowNegative
                  className={classes.input}
                  step="0.01"
                  value={form.priceModifierValue}
                  onChange={(v) => set('priceModifierValue', v)}
                />
              </div>
            </>
          )}

          <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
            <label>Описание</label>
            <textarea
              className={classes.textarea}
              rows={2}
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>
          </>)}

          {form.forOperator && at(1) && (
            <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Договор с партнёром *</label>
              <Select
                className={classes.input}
                value={chosenContract ? chosenContract.partnerId + '|' + chosenContract.number : ''}
                onChange={(e) => {
                  const c = contracts.find((x) => x.partnerId + '|' + x.number === e.target.value);
                  setForm((f) => reconcileSlice(c, partners.find((p) => p.id === c?.partnerId), {
                    ...f,
                    operatorContract: c?.number ?? '',
                    partnerId: c?.partnerId ?? '',
                    partnerAccountId: '',
                    partnerCustomerId: '',
                    guestKind: '',
                    /* Питание — из выбранного договора: вариант, которого в нём
                       нет, не посчитается никогда. */
                    mealPlan: mealForContract(c, f.mealPlan),
                  }));
                }}
              >
                <option value="">— выберите договор —</option>
                {contracts.map((c) => (
                  <option key={c.partnerId + '|' + c.number} value={c.partnerId + '|' + c.number}>
                    {'Договор ' + c.number + (c.account ? ' · ' + c.account.name : '') + (c.hasPrices ? '' : ' — цен нет')}
                  </option>
                ))}
              </Select>
              <div className={classes.fieldHint}>
                {contracts.length
                  ? 'Цены тарифа берутся из этого договора. Меняется договор в реестре — меняется и тариф.'
                  : 'Договоры Kars Avia для вашей гостиницы ещё не пришли. Обратитесь к диспетчеру Kars Avia.'}
              </div>
            </div>
          )}

          {form.forOperator && at(2) && (
            <>
              <div className={classes.formGroup}>
                <label>Юрлицо партнёра</label>
                <Select className={classes.input} value={form.partnerAccountId} onChange={(e) => setSlice('partnerAccountId', e.target.value)}>
                  {!chosenContract?.account && <option value="">Любое юрлицо</option>}
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.inn ? ' (ИНН ' + a.inn + ')' : ''}</option>
                  ))}
                </Select>
                <div className={classes.fieldHint}>{chosenContract?.account ? 'Юрлицо указано в договоре.' : 'Договор не ограничен одним юрлицом.'}</div>
              </div>
              <div className={classes.formGroup}>
                <label>Авиакомпания</label>
                <Select className={classes.input} value={form.partnerCustomerId} onChange={(e) => setSlice('partnerCustomerId', e.target.value)}>
                  {options.anyCustomer && <option value="">Любая авиакомпания</option>}
                  {options.customers
                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className={classes.formGroup}>
                <label>Вид брони</label>
                <Select className={classes.input} value={form.guestKind} onChange={(e) => setSlice('guestKind', e.target.value)}>
                  {options.kinds.map((k) => <option key={k ?? 'any'} value={k ?? ''}>{k ? GUEST_KIND_LABELS[k] : 'Любой вид брони'}</option>)}
                </Select>
              </div>
              <div className={classes.formGroup}>
                <label>Питание *</label>
                <Select className={classes.input} value={form.mealPlan} onChange={(e) => setSlice('mealPlan', e.target.value)}>
                  {options.meals.map((m) => (
                    <option key={m} value={m}>{MEAL_PLAN_LABELS[m] ?? m}</option>
                  ))}
                </Select>
                <div className={classes.fieldHint}>
                  {options.waiting ? 'Выберите ожидаемые условия. До прихода подходящих цен тариф не продаётся.' : 'Питание доступно для выбранной авиакомпании и вида брони. Его цена — из договора.'}
                </div>
              </div>
              {(options.unresolvedAccount || options.unresolvedCustomer) && <div className={classes.formError} role="alert">
                Юрлицо или авиакомпания договора отсутствует в справочнике партнёра. Попросите диспетчера обновить справочник.
              </div>}
            </>
          )}

          {form.forOperator && step === 3 && (
            <div className={classes.reviewSummary}>
              <div className={classes.reviewHeading}><div><span className={classes.reviewOverline}>Корпоративный тариф</span><h3>{form.name}</h3></div><code>{form.code}</code></div>
              <dl className={classes.reviewFacts}>
                <div><dt>Договор</dt><dd>№ {form.operatorContract}</dd></div>
                <div><dt>Юрлицо</dt><dd>{partner?.accounts?.find((a) => a.id === form.partnerAccountId)?.name ?? chosenContract?.account?.name ?? 'Любое'}</dd></div>
                <div><dt>Авиакомпания</dt><dd>{partner?.customers?.find((c) => c.id === form.partnerCustomerId)?.name ?? 'Любая'}</dd></div>
                <div><dt>Вид брони</dt><dd>{form.guestKind ? GUEST_KIND_LABELS[form.guestKind] : 'Любой'}</dd></div>
                <div><dt>Питание</dt><dd>{MEAL_PLAN_LABELS[form.mealPlan] ?? form.mealPlan}</dd></div>
              </dl>
            </div>
          )}

          {!form.forOperator && created && step === 4 && (
            <OwnTariffCheck plan={created} form={form} />
          )}
        </div>
        )}

        {form.forOperator && step === 3 && <section className={classes.reviewPrices} aria-label="Цены выбранного договора">
          <div className={classes.reviewPricesTitle}><h3>Цены из договора</h3><span>Применяются автоматически после синхронизации</span></div>
          <ContractTariffPreview
          key={contractViewKey(form)} form={form} onStateChange={setPreviewState}
        /></section>}

        {/* Цены и сезоны остаются смонтированными, пока окно открыто: их
            черновики живут в самих экранах, и переход по шагам не должен их
            выбрасывать. Виден только текущий шаг. */}
        {!form.forOperator && created && (
          <>
            <div className={classes.wizardEditor} style={{ display: step === 2 ? undefined : 'none' }}>
              <StandardPrices plan={created} roomTypes={roomTypes} saveRef={pricesSave} />
            </div>
            <div className={classes.wizardEditor} style={{ display: step === 3 ? undefined : 'none' }}>
              <Seasons plan={created} roomTypes={roomTypes} saveRef={seasonsSave} />
            </div>
          </>
        )}

        {error && (
          <div className={classes.formError} role="alert">{error}</div>
        )}
        {showRequired && !canNext && <div className={classes.formError} role="alert">{requiredHint}</div>}
        </fieldset>
        </div>

        <div className={classes.modalFooter}>
          {!isNew && step === 0 && (
            <button className={classes.btnDelete} disabled={busy} onClick={() => setConfirmDelete(true)}>Удалить</button>
          )}
          {step > 0 && (
            <button className={classes.btnCancel} disabled={busy} onClick={() => setStep(step - 1)}>Назад</button>
          )}
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} disabled={busy} onClick={closeGuard.requestClose}>{created ? 'Закрыть' : 'Отмена'}</button>
          {step < finalStep ? (
            <span className={classes.actionGate} onClick={() => { if (!canNext && !busy) setShowRequired(true); }}>
            <button
              className={classes.btnSave}
              disabled={!canNext || busy}
              onClick={async () => {
                setSavingStep(true);
                try {
                /* Первый шаг своего тарифа — создание: без id не покажешь ни
                   цены, ни сезоны, а второго окна больше нет. */
                if (!form.forOperator && isNew && step === 1 && !created) {
                  const createdPlan = await onSave(form);
                  if (createdPlan) {
                    setCreated(createdPlan);
                    /* id в форме: дальше «Далее»/«Готово» — это правка уже
                       созданного тарифа, а не второй тариф. */
                    setForm((f) => ({ ...f, id: createdPlan.id }));
                    setStep(2);
                  }
                  return;
                }
                if (!form.forOperator && created && (step === 2 || step === 3)) {
                  const result = await saveSteps([step]);
                  if (!result.saved) return;
                }
                setStep(step + 1);
                } finally { setSavingStep(false); }
              }}
            >
              {busy ? 'Сохранение…' : priceStep ? 'Сохранить и далее' : 'Далее'}
            </button>
            </span>
          ) : (
            <button
              className={classes.btnSave}
              disabled={busy || !canFinish}
              onClick={async () => {
                /* «Готово» у своего тарифа тоже пишет форму: после создания его
                   можно переименовать, вернувшись на первый шаг, — правка
                   должна сохраниться, и тариф остаётся один. */
                setSavingStep(true);
                try {
                  const result = await saveSteps(!form.forOperator && created ? [2, 3] : [], () => onSave(form));
                  if (result.saved) onClose();
                  else setStep(result.step);
                } finally { setSavingStep(false); }
              }}
            >
              {busy
                ? 'Сохранение...'
                : isNew
                  ? (form.forOperator ? 'Создать тариф' : 'Готово')
                  : 'Сохранить'}
            </button>
          )}
        </div>
      </DialogLayer>
      {closeGuard.confirmation}
      <ConfirmDialog open={confirmDelete} title="Удалить тариф?" message={`Тариф «${plan?.name ?? form.name}» будет удалён. Если он используется в бронированиях, система не позволит его удалить.`}
        confirmLabel="Удалить тариф" danger onClose={() => setConfirmDelete(false)} onConfirm={() => onDelete(plan.id)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OccupancyGrid — цена по числу гостей: категория × «на любое», 1, 2, …
// ─────────────────────────────────────────────────────────────────────────────
function OccupancyGrid({ roomTypes, occs, values, onChange, disabled = false }) {
  return (
    <div className={classes.occWrap}>
      <table className={classes.occTable}>
        <thead>
          <tr>
            <th>Категория</th>
            {occs.map((o) => <th key={o}>{o === 0 ? 'одна цена' : `на ${occupancyLabel(o)}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {roomTypes.map((rt) => (
            <tr key={rt.id}>
              <td>
                <div className={classes.stdName}>{rt.name}</div>
                <div className={classes.stdMeta}>до {rt.maxOccupancy ?? '?'} чел.</div>
              </td>
              {occs.map((o) => {
                const k = priceKey(rt.id, o);
                // Гостей больше, чем помещается в номер, не бывает — и цены на них тоже.
                if (o > 0 && rt.maxOccupancy != null && o > rt.maxOccupancy) {
                  return <td key={o} className={classes.occNone}>—</td>;
                }
                return (
                  <td key={o}>
                    <div className={classes.priceInputWrap}>
                      <NumberInput
                        disabled={disabled}
                        className={classes.input}
                        min="0"
                        step="0.01"
                        value={values[k] ?? ''}
                        placeholder="—"
                        onChange={(v) => onChange(k, (v == null ? '' : String(v)))}
                      />
                      <span className={classes.priceCurrency}>₽</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StandardPrices — baseline price per category (the "everyday" price)
// ─────────────────────────────────────────────────────────────────────────────
function SavedMark({ at }) {
  return (
    <span style={{ fontSize: 12.5, color: '#2E7D32' }}>
      Сохранено в {at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

function StandardPrices({ plan, roomTypes, saveRef }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('rate.update');
  const { data: standard = [], isLoading } = useStandardRates(plan.id);
  const save = useSetStandardRates();
  const occs = useMemo(() => occupancyColumns(plan, roomTypes), [plan, roomTypes]);

  const stdMap = useMemo(() => {
    const m = {};
    standard.forEach((s) => { m[priceKey(s.roomTypeId, s.occupancy ?? 0)] = String(s.price); });
    return m;
  }, [standard]);

  const [draft, setDraft] = useState(stdMap);
  const [error, setError] = useState(null);
  /* 5.2 · на записи было непонятно, сохранилось ли: отметка — прямо у кнопки. */
  const [savedAt, setSavedAt] = useState(null);
  useEffect(() => { setDraft(stdMap); setError(null); }, [stdMap, plan.id]);

  const cells = useMemo(
    () => roomTypes.flatMap((rt) => occs.filter((o) => o === 0 || o <= (rt.maxOccupancy ?? o)).map((o) => [rt.id, o])),
    [roomTypes, occs],
  );
  const dirty = cells.some(([rt, o]) => (draft[priceKey(rt, o)] ?? '') !== (stdMap[priceKey(rt, o)] ?? ''));

  const handleSave = async () => {
    if (!canEdit) return false;
    setError(null);
    if (isLoading || save.isPending) return false;
    if (!dirty) return true;
    const items = cells.map(([rt, o]) => ({
      roomTypeId: rt,
      occupancy: o,
      price: Number(draft[priceKey(rt, o)]) || 0,
    }));
    try {
      await save.mutateAsync({ ratePlanId: plan.id, items });
      setSavedAt(new Date());
      return true;
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
      return false;
    }
  };
  useEffect(() => { if (saveRef) saveRef.current = handleSave; });

  return (
    <div>
      <div className={classes.sectionHint}>
        Цена за ночь на все даты. На отдельные даты её меняют сезоны и календарь.
        {plan.partnerId && (
          <> «Одна цена» — сколько бы ни было гостей. Цена на двоих главнее одной цены.
          <b> Нет цены на нужное число гостей — тариф к брони не применится.</b></>
        )}
      </div>
      {roomTypes.length === 0 ? (
        <div className={classes.seasonsEmpty}>Нет категорий номеров. Создайте их в разделе «Номера».</div>
      ) : plan.partnerId ? (
        <OccupancyGrid
          disabled={!canEdit}
          roomTypes={roomTypes}
          occs={occs}
          values={draft}
          onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
        />
      ) : (
        <div className={classes.stdTable}>
          {roomTypes.map((rt) => (
            <div key={rt.id} className={classes.stdRow}>
              <div>
                <div className={classes.stdName}>{rt.name}</div>
                <div className={classes.stdMeta}>
                  до {rt.maxOccupancy ?? '?'} чел.
                  {rt.basePrice != null && ` · базовая цена категории ${fmtRub(rt.basePrice)} ₽`}
                </div>
              </div>
              <div className={classes.priceInputWrap}>
                <NumberInput
                  disabled={!canEdit}
                  className={classes.input}
                  min="0"
                  step="0.01"
                  value={draft[priceKey(rt.id, 0)] ?? ''}
                  placeholder="—"
                  onChange={(v) => setDraft((d) => ({ ...d, [priceKey(rt.id, 0)]: (v == null ? '' : String(v)) }))}
                />
                <span className={classes.priceCurrency}>₽</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className={classes.formError} role="alert">{error}</div>}
      {canEdit && roomTypes.length > 0 && (
        <div className={classes.sectionActions}>
          <button className={classes.btnPrimary} onClick={handleSave} disabled={!dirty || save.isPending || isLoading}>
            {save.isPending ? 'Сохранение...' : 'Сохранить базовые цены'}
          </button>
          {dirty && <button className={classes.btnGhost} onClick={() => setDraft(stdMap)}>Сбросить</button>}
          {!dirty && savedAt && <SavedMark at={savedAt} />}
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>Пустое поле или 0 — без базовой цены</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Seasons — named date ranges with a price per category
// ─────────────────────────────────────────────────────────────────────────────
function Seasons({ plan, roomTypes, saveRef }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('rate.update');
  const { data: seasonRows = [], isLoading } = useSeasons(plan.id);
  const save = useReplaceSeasons();
  const [savedAt, setSavedAt] = useState(null);
  const [removing, setRemoving] = useState(null);

  // Group flat rows back into seasons keyed by their identity.
  const initial = useMemo(() => {
    const map = new Map();
    seasonRows.forEach((r) => {
      const key = `${r.sortOrder}|${r.name}|${day10(r.dateFrom)}|${day10(r.dateTo)}`;
      if (!map.has(key)) {
        map.set(key, {
          name: r.name,
          color: r.color || SEASON_COLORS[0],
          dateFrom: day10(r.dateFrom),
          dateTo: day10(r.dateTo),
          sortOrder: r.sortOrder ?? 0,
          prices: {},
        });
      }
      map.get(key).prices[priceKey(r.roomTypeId, r.occupancy ?? 0)] = String(r.price);
    });
    return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [seasonRows]);

  const [list, setList] = useState(initial);
  const [error, setError] = useState(null);
  useEffect(() => { setList(initial); setError(null); }, [initial, plan.id]);

  const dirty = JSON.stringify(list) !== JSON.stringify(initial);

  const occs = useMemo(() => occupancyColumns(plan, roomTypes), [plan, roomTypes]);
  const update = (idx, patch) => setList((l) => l.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const updatePrice = (idx, k, v) =>
    setList((l) => l.map((s, i) => (i === idx ? { ...s, prices: { ...s.prices, [k]: v } } : s)));

  const addSeason = () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    setList((l) => [
      ...l,
      { name: '', color: SEASON_COLORS[l.length % SEASON_COLORS.length], dateFrom: today, dateTo: today, sortOrder: l.length, prices: {} },
    ]);
  };
  const removeSeason = (idx) => setList((l) => l.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!canEdit) return false;
    setError(null);
    if (isLoading || save.isPending) return false;
    if (!dirty) return true;
    for (const s of list) {
      if (!s.name.trim()) { setError('У каждого сезона должно быть название'); return false; }
      if (s.dateTo < s.dateFrom) { setError(`Сезон «${s.name}»: дата окончания раньше начала`); return false; }
    }
    const payload = {
      ratePlanId: plan.id,
      seasons: list.map((s, idx) => ({
        name: s.name.trim(),
        color: s.color,
        dateFrom: s.dateFrom,
        dateTo: s.dateTo,
        sortOrder: idx,
        items: roomTypes.flatMap((rt) =>
          occs
            .filter((o) => (o === 0 || o <= (rt.maxOccupancy ?? o)) && Number(s.prices[priceKey(rt.id, o)]) > 0)
            .map((o) => ({ roomTypeId: rt.id, occupancy: o, price: Number(s.prices[priceKey(rt.id, o)]) })),
        ),
      })),
    };
    try {
      await save.mutateAsync(payload);
      setSavedAt(new Date());
      return true;
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
      return false;
    }
  };
  useEffect(() => { if (saveRef) saveRef.current = handleSave; });

  return (
    <div>
      <div className={classes.sectionHint}>
        Сезон — это период (например, «Высокий сезон» или «Новогодние праздники») со своей ценой.
        В эти даты цена сезона заменяет базовую. Индивидуальные цены на конкретный день — в календаре — главнее сезона.
      </div>

      {roomTypes.length === 0 ? (
        <div className={classes.seasonsEmpty}>Сначала создайте категории номеров в разделе «Номера».</div>
      ) : list.length === 0 ? (
        <div className={classes.seasonsEmpty}>Сезонов пока нет. Добавьте первый, чтобы поднять или снизить цену на нужный период.</div>
      ) : (
        <div className={classes.seasonList}>
          {list.map((s, idx) => (
            <div key={idx} className={classes.seasonCard}>
              <div className={classes.seasonCardHead}>
                <input
                  disabled={!canEdit}
                  type="color"
                  className={classes.colorInput}
                  value={s.color}
                  onChange={(e) => update(idx, { color: e.target.value })}
                  title="Цвет в календаре"
                />
                <input
                  disabled={!canEdit}
                  className={`${classes.input} ${classes.seasonNameInput}`}
                  value={s.name}
                  placeholder="Название сезона"
                  onChange={(e) => update(idx, { name: e.target.value })}
                />
                <div className={classes.seasonDates}>
                  <DateInput disabled={!canEdit} className={classes.input} value={s.dateFrom} onChange={(e) => update(idx, { dateFrom: e.target.value })} style={{ width: 150 }} />
                  <span>—</span>
                  <DateInput disabled={!canEdit} className={classes.input} value={s.dateTo} onChange={(e) => update(idx, { dateTo: e.target.value })} style={{ width: 150 }} />
                </div>
                {canEdit && <button className={classes.seasonRemove} onClick={() => setRemoving(idx)}>Удалить</button>}
              </div>
              {plan.partnerId ? (
                <OccupancyGrid
                  disabled={!canEdit}
                  roomTypes={roomTypes}
                  occs={occs}
                  values={s.prices}
                  onChange={(k, v) => updatePrice(idx, k, v)}
                />
              ) : (
              <div className={classes.seasonPrices}>
                {roomTypes.map((rt) => (
                  <div key={rt.id} className={classes.seasonPriceRow}>
                    <label>{rt.name}</label>
                    <div className={classes.priceInputWrap}>
                      <NumberInput
                        disabled={!canEdit}
                        className={classes.input}
                        min="0"
                        step="0.01"
                        value={s.prices[priceKey(rt.id, 0)] ?? ''}
                        placeholder="—"
                        onChange={(v) => updatePrice(idx, priceKey(rt.id, 0), (v == null ? '' : String(v)))}
                      />
                      <span className={classes.priceCurrency}>₽</span>
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div className={classes.formError} role="alert">{error}</div>}
      <ConfirmDialog open={canEdit && removing !== null} title="Удалить сезон?" message={`Сезон «${list[removing]?.name || 'Без названия'}» будет убран из списка вместе с введёнными ценами. Изменение вступит в силу после сохранения сезонов.`}
        confirmLabel="Удалить сезон" danger onClose={() => setRemoving(null)} onConfirm={() => removeSeason(removing)} />

      {canEdit && roomTypes.length > 0 && (
        <div className={classes.sectionActions}>
          <button className={classes.btnGhost} onClick={addSeason}>+ Добавить сезон</button>
          <div style={{ flex: 1 }} />
          {dirty && <button className={classes.btnGhost} onClick={() => setList(initial)}>Отмена</button>}
          <button className={classes.btnPrimary} onClick={handleSave} disabled={!dirty || save.isPending || isLoading}>
            {save.isPending ? 'Сохранение...' : 'Сохранить сезоны'}
          </button>
          {!dirty && savedAt && <SavedMark at={savedAt} />}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FillModal — apply one price to a date range (per-day overrides)
// ─────────────────────────────────────────────────────────────────────────────

function FillModal({ roomTypes, defaultFrom, defaultTo, onFill, onClose, saving, error }) {
  const [form, setForm] = useState({
    roomTypeId: roomTypes[0]?.id ?? '',
    from: defaultFrom,
    to:   defaultTo,
    price: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const initial = useRef(formSignature(form));
  const closeGuard = useModalCloseGuard({ onClose, busy: saving, dirty: formSignature(form) !== initial.current });

  return (
    <>
      <DialogLayer title="Заполнить диапазон" onClose={closeGuard.requestClose} busy={saving} backdropClassName={classes.overlay} className={`${classes.modal} ${classes.wizardModal}`} style={{ maxWidth: 480 }}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>Заполнить диапазон</div>
          <button className={classes.closeBtn} aria-label="Закрыть окно" disabled={saving} onClick={closeGuard.requestClose}>✕</button>
        </div>
        <div className={classes.formGrid} style={{ gridTemplateColumns: '1fr' }}>
          <div className={classes.formGroup}>
            <label>Категория номеров</label>
            <Select className={classes.input} value={form.roomTypeId} onChange={e => set('roomTypeId', e.target.value)}>
              {roomTypes.map(rt => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </Select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className={classes.formGroup}>
              <label>С даты</label>
              <DateInput className={classes.input} value={form.from} onChange={e => set('from', e.target.value)} />
            </div>
            <div className={classes.formGroup}>
              <label>По дату</label>
              <DateInput className={classes.input} value={form.to} onChange={e => set('to', e.target.value)} />
            </div>
          </div>
          <div className={classes.formGroup}>
            <label>Цена за ночь, ₽&nbsp;&nbsp;<span style={{ color: '#6B7280', fontWeight: 400 }}>(0 — удалить цены)</span></label>
            <NumberInput
              className={classes.input}
              min="0"
              step="0.01"
              value={form.price}
              placeholder="3800"
              onChange={(v) => set('price', (v == null ? '' : String(v)))}
            />
          </div>
        </div>
        {error && <div style={{ padding: '0 24px 12px', color: '#EF4444', fontSize: 13 }}>{error}</div>}
        <div className={classes.modalFooter}>
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} disabled={saving} onClick={closeGuard.requestClose}>Отмена</button>
          <button
            className={classes.btnSave}
            disabled={saving || !form.roomTypeId || form.price === ''}
            onClick={() => onFill({ roomTypeId: form.roomTypeId, fromDate: form.from, toDate: form.to, price: +form.price })}
          >
            {saving ? 'Применяется...' : 'Применить'}
          </button>
        </div>
      </DialogLayer>
      {closeGuard.confirmation}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RateCalendar — month grid showing resolved prices (override → season → standard)
// ─────────────────────────────────────────────────────────────────────────────
function RateCalendar({ plan, roomTypes }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('rate.update');
  // Rolling window like the шахматка: a week before today, then forward.
  const [viewStart, setViewStart] = useState(() => subDays(TODAY, 7));
  const [daysCount, setDaysCount] = useState(14);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => getYear(TODAY));

  // Dynamic column width so the window fills the container — no horizontal scroll.
  const containerRef = useRef(null);
  const [dayWidth, setDayWidth] = useState(CAL_DAY_MIN);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setDayWidth(Math.max(CAL_DAY_MIN, (w - CAL_LABEL_W) / Math.min(daysCount, 31)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [daysCount]);

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(viewStart, i)),
    [viewStart, daysCount],
  );
  const dayStrs = useMemo(() => days.map(d => format(d, 'yyyy-MM-dd')), [days]);
  const fromStr = dayStrs[0];
  const toStr   = dayStrs[dayStrs.length - 1];

  /* Тариф партнёра считается по числу гостей строго (29.09.2026), и цена дня
     на двоих одному не достаётся. Календарь такого тарифа показывает и правит
     цены на ВЫБРАННОЕ число гостей — смешать их в одной сетке значило бы
     показать гостинице цифру, по которой бронь не посчитают. */
  const partnerOccs = useMemo(
    () => (plan.partnerId ? occupancyColumns(plan, roomTypes).filter((o) => o > 0) : []),
    [plan, roomTypes],
  );
  const [occ, setOcc] = useState(1);
  const occupancy = plan.partnerId ? occ : undefined;

  const { data: rates = [], isFetching } = useRates({ ratePlanId: plan.id, from: fromStr, to: toStr, occupancy });
  const { data: standardAll = [] } = useStandardRates(plan.id);
  const { data: seasonsAll = [] } = useSeasons(plan.id);
  const bulkUpsert = useBulkUpsertRates();
  const fillMutation = useFillRates();

  const standard = useMemo(() => pickOccupancy(standardAll, occupancy, (r) => r.roomTypeId), [standardAll, occupancy]);
  const seasons = useMemo(
    () => pickOccupancy(seasonsAll, occupancy, (r) => `${r.roomTypeId}|${r.sortOrder}|${r.name}|${day10(r.dateFrom)}|${day10(r.dateTo)}`),
    [seasonsAll, occupancy],
  );
  const resolve = useMemo(() => buildResolver(standard, seasons), [standard, seasons]);

  const SEP = '|';

  // Per-day manual overrides (Rate rows).
  const overrideMap = useMemo(() => {
    const map = {};
    rates.forEach(r => { map[`${r.roomTypeId}${SEP}${day10(r.date)}`] = String(r.price); });
    return map;
  }, [rates]);

  const [pending, setPending] = useState({});
  const [editingCell, setEditingCell] = useState(null);
  const [showFill, setShowFill] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fillError, setFillError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { setPending({}); setSaveError(null); }, [plan.id, occ]);
  useEffect(() => { if (editingCell && inputRef.current) inputRef.current.focus(); }, [editingCell]);

  const isDirty = Object.keys(pending).length > 0;

  // Effective info for a cell: override (pending or saved) wins, else baseline.
  const cellInfo = (rtId, date) => {
    // Гостей больше вместимости номера не бывает — и цены на них тоже.
    const cap = roomTypes.find((r) => r.id === rtId)?.maxOccupancy;
    if (occupancy && cap != null && occupancy > cap) return { value: '', source: 'none' };
    const key = `${rtId}${SEP}${date}`;
    const override = key in pending ? pending[key] : overrideMap[key];
    if (override != null && override !== '') {
      return { value: override, source: 'override' };
    }
    const base = resolve(rtId, date);
    if (base) return { value: base.price, source: base.source, season: base.season };
    return { value: '', source: 'none' };
  };

  const startEdit = (rtId, date) => {
    if (!canEdit) return;
    const key = `${rtId}${SEP}${date}`;
    setPending(p => ({ ...p, [key]: p[key] ?? overrideMap[key] ?? '' }));
    setEditingCell({ rtId, date });
  };

  const commitCell = (rtId, date, value) => {
    if (!canEdit) return;
    const key = `${rtId}${SEP}${date}`;
    const cleaned = value.trim();
    if (cleaned === '' || isNaN(Number(cleaned))) {
      setPending(p => { const np = { ...p }; delete np[key]; return np; });
    } else {
      setPending(p => ({ ...p, [key]: cleaned }));
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e, rtId, date, value) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCell(rtId, date, value);
    } else if (e.key === 'Escape') {
      const key = `${rtId}${SEP}${date}`;
      setPending(p => { const np = { ...p }; delete np[key]; return np; });
      setEditingCell(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitCell(rtId, date, value);
      const idx = dayStrs.indexOf(date);
      if (idx < dayStrs.length - 1) {
        const nextDate = dayStrs[idx + 1];
        const nextKey = `${rtId}${SEP}${nextDate}`;
        setPending(p => ({ ...p, [nextKey]: p[nextKey] ?? overrideMap[nextKey] ?? '' }));
        setEditingCell({ rtId, date: nextDate });
      }
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaveError(null);
    const items = Object.entries(pending).map(([key, priceStr]) => {
      const sepIdx = key.indexOf(SEP);
      return {
        ratePlanId: plan.id,
        roomTypeId: key.slice(0, sepIdx),
        date: key.slice(sepIdx + 1),
        price: Number(priceStr) || 0,
        ...(occupancy ? { occupancy } : {}),
      };
    });
    try {
      await bulkUpsert.mutateAsync(items);
      setPending({});
    } catch (err) {
      const msg = err?.response?.data?.message;
      setSaveError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка сохранения'));
    }
  };

  const handleFill = async (data) => {
    if (!canEdit) return;
    setFillError(null);
    try {
      await fillMutation.mutateAsync({ ...data, ratePlanId: plan.id, ...(occupancy ? { occupancy } : {}) });
      setShowFill(false);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFillError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const todayStr = format(TODAY, 'yyyy-MM-dd');

  // Period navigation, mirroring the шахматка.
  const goToday = () => setViewStart(subDays(TODAY, 7));
  const navStep = daysCount === 14 ? 7 : 14;
  const prevPeriod = () => setViewStart(v => subDays(v, navStep));
  const nextPeriod = () => setViewStart(v => addDays(v, navStep));

  const viewEnd = days[days.length - 1] ?? viewStart;
  const monthLabel = (() => {
    const startLabel = format(viewStart, 'LLLL', { locale: ru }).replace(/^\w/, c => c.toUpperCase());
    if (getMonth(viewEnd) !== getMonth(viewStart)) {
      return `${startLabel} – ${format(viewEnd, 'LLLL', { locale: ru })} ${format(viewEnd, 'yyyy')}`;
    }
    return `${startLabel} ${format(viewStart, 'yyyy')}`;
  })();

  const gridWidth = CAL_LABEL_W + daysCount * dayWidth;

  return (
    <div>
      <div className={classes.sectionHint}>
        Календарь показывает итоговую цену каждого дня. <b style={{ color: '#1D4ED8' }}>Синим</b> — индивидуальная цена дня,
        цветная полоса сверху — действует сезон, серым — базовая цена. {canEdit && 'Нажмите на ячейку, чтобы задать цену конкретного дня.'}
      </div>

      <div className={classes.calendarRoot}>
        <div className={classes.calendarHeader}>
          <div className={classes.calMonth}>
            <button className={classes.calNavBtn} onClick={prevPeriod}>‹</button>
            <div className={classes.calMonthLabelWrap}>
              <button
                className={classes.calMonthLabelBtn}
                onClick={() => { setPickerYear(getYear(viewStart)); setShowMonthPicker(v => !v); }}
              >
                {monthLabel}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {showMonthPicker && (
                <MonthPicker
                  year={pickerYear}
                  onYearChange={setPickerYear}
                  onSelect={(year, month) => {
                    setViewStart(startOfMonth(setMonth(setYear(new Date(), year), month)));
                    setShowMonthPicker(false);
                  }}
                  onClose={() => setShowMonthPicker(false)}
                />
              )}
            </div>
            <button className={classes.calNavBtn} onClick={nextPeriod}>›</button>
            <button className={classes.calTodayBtn} onClick={goToday}>Сегодня</button>
            {partnerOccs.length > 0 && (
              <Select
                className={`${classes.input} ${classes.calOccSelect}`}
                value={occ}
                onChange={(e) => setOcc(Number(e.target.value))}
                title="Цены тарифа партнёра — по числу гостей в номере"
              >
                {partnerOccs.map((o) => <option key={o} value={o}>Цены на {occupancyLabel(o)}</option>)}
              </Select>
            )}
            <div className={classes.calDaysToggle}>
              {[14, 30].map(n => (
                <button
                  key={n}
                  className={`${classes.calDaysToggleBtn} ${daysCount === n ? classes.calDaysToggleActive : ''}`}
                  onClick={() => setDaysCount(n)}
                >{n} дн</button>
              ))}
            </div>
          </div>
          {canEdit && <div className={classes.planPanelActions}>
            {isDirty ? (
              <>
                <button className={classes.btnPrimary} onClick={handleSave} disabled={bulkUpsert.isPending}>
                  {bulkUpsert.isPending ? 'Сохранение...' : `Сохранить (${Object.keys(pending).length})`}
                </button>
                <button className={classes.btnGhost} onClick={() => setPending({})}>Отмена</button>
              </>
            ) : (
              <>
                <span className={classes.calHint}>{isFetching ? 'Загрузка...' : 'Tab — следующий день'}</span>
                <button className={classes.btnGhost} onClick={() => setShowFill(true)} disabled={roomTypes.length === 0}>Заполнить диапазон</button>
              </>
            )}
          </div>}
        </div>

        {saveError && (
          <div style={{ padding: '8px 4px', color: '#DC2626', fontSize: 13 }}>{saveError}</div>
        )}

        {roomTypes.length === 0 ? (
          <div className={classes.calendarEmpty}>Нет категорий номеров. Создайте категории в разделе «Номера».</div>
        ) : (
          <div className={classes.calendarScroll} ref={containerRef}>
            <div
              className={classes.calendarGrid}
              style={{ gridTemplateColumns: `${CAL_LABEL_W}px repeat(${daysCount}, ${dayWidth}px)`, width: gridWidth }}
            >
              <div className={classes.calCornerCell}>Категория</div>
              {dayStrs.map(d => {
                const dow = parseISO(d).getDay();
                const isWe = dow === 0 || dow === 6;
                const isToday = d === todayStr;
                return (
                  <div key={d} className={[classes.calDayHeader, isWe && classes.calWeekend, isToday && classes.calToday].filter(Boolean).join(' ')}>
                    <div className={classes.calDayNum}>{format(parseISO(d), 'd')}</div>
                    <div className={classes.calDow}>{DOW_SHORT[dow]}</div>
                  </div>
                );
              })}

              {roomTypes.map(rt => (
                <React.Fragment key={rt.id}>
                  <div className={classes.calRowLabel}>
                    <div className={classes.calRoomTypeName}>{rt.name}</div>
                    <div className={classes.calRoomTypeMeta}>до {rt.maxOccupancy ?? '?'} чел.</div>
                  </div>
                  {dayStrs.map(d => {
                    const key = `${rt.id}${SEP}${d}`;
                    const isEditing = canEdit && editingCell?.rtId === rt.id && editingCell?.date === d;
                    const info = cellInfo(rt.id, d);
                    const hasPending = key in pending;
                    const dow = parseISO(d).getDay();
                    const isWe = dow === 0 || dow === 6;
                    const isToday = d === todayStr;
                    const editVal = isEditing ? (pending[key] ?? '') : '';

                    return (
                      <div
                        key={d}
                        className={[
                          classes.calCell, classes.calCellRel,
                          isToday && classes.calCellToday,
                          isWe && classes.calCellWeekend,
                        ].filter(Boolean).join(' ')}
                        style={hasPending ? { background: '#FFFBEB' } : {}}
                        onClick={canEdit ? () => !isEditing && startEdit(rt.id, d) : undefined}
                        title={info.source === 'season' ? `Сезон: ${info.season?.name}` : undefined}
                      >
                        {info.source === 'season' && info.season?.color && (
                          <span className={classes.cellSeasonStripe} style={{ background: info.season.color }} />
                        )}
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            className={classes.calInput}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            value={editVal}
                            placeholder={info.value ? fmtRub(info.value) : ''}
                            onChange={e => setPending(p => ({ ...p, [key]: e.target.value }))}
                            onBlur={e => commitCell(rt.id, d, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, rt.id, d, editVal)}
                          />
                        ) : info.value !== '' ? (
                          <span className={
                            info.source === 'override' ? classes.cellOverride
                            : info.source === 'season' ? classes.cellSeason
                            : classes.cellStandard
                          }>
                            {fmtRub(info.value)}
                          </span>
                        ) : (
                          <span className={classes.calNoPrice}>—</span>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      {canEdit && showFill && (
        <FillModal
          roomTypes={roomTypes}
          defaultFrom={fromStr}
          defaultTo={toStr}
          onFill={handleFill}
          onClose={() => { setShowFill(false); setFillError(null); }}
          saving={fillMutation.isPending}
          error={fillError}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MonthPicker — popover for jumping the calendar window to a given month
// ─────────────────────────────────────────────────────────────────────────────
function MonthPicker({ year, onYearChange, onSelect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className={classes.calMonthPicker}>
      <div className={classes.calMonthPickerYear}>
        <button className={classes.calMonthPickerYearBtn} onClick={() => onYearChange(y => y - 1)}>‹</button>
        <span className={classes.calMonthPickerYearLabel}>{year}</span>
        <button className={classes.calMonthPickerYearBtn} onClick={() => onYearChange(y => y + 1)}>›</button>
      </div>
      <div className={classes.calMonthPickerGrid}>
        {MONTHS_RU.map((name, i) => (
          <button key={i} className={classes.calMonthPickerCell} onClick={() => onSelect(year, i)}>
            {name.slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanPanel — подтабы по типу тарифа: цены договора или свои цены и сезоны
// ─────────────────────────────────────────────────────────────────────────────
function PlanPanel({ plan, roomTypes, onEditPlan, partners, canEdit, onOpenContract, headingRef }) {
  const [tab, setTab] = useState(plan.forOperator ? 'contract' : 'standard');
  const { data: seasons = [] } = useSeasons(plan.id);
  const seasonCount = useMemo(() => {
    const set = new Set(seasons.map((s) => `${s.sortOrder}|${s.name}|${day10(s.dateFrom)}|${day10(s.dateTo)}`));
    return set.size;
  }, [seasons]);

  useEffect(() => {
    setTab(plan.forOperator ? 'contract' : 'standard');
  }, [plan.id, plan.forOperator]);

  return (
    <div className={classes.planPanel}>
      <div className={classes.planPanelHeader}>
        <div>
          <h2 ref={headingRef} className={classes.planPanelTitle} tabIndex={-1}>{plan.name}</h2>
          <div className={classes.planPanelMeta}>
            <code>{plan.code}</code>
            {' · '}{MEAL_PLAN_LABELS[plan.mealPlan] ?? plan.mealPlan}
            {plan.parentRatePlanId && ' · наследует цены'}
            {plan.forOperator && ` · договор ${plan.operatorContract ?? '—'}`}
            {!plan.isActive && <span style={{ marginLeft: 8, color: '#EF4444' }}>Неактивен</span>}
          </div>
          {/* Состояние корпоративного тарифа считает сервер по цене договора —
              строка показывает его причины, своих слов экран не добавляет. */}
          {plan.forOperator && <div className={classes.tariffStatus}>
            {plan.operatorStatus?.applies ? 'Работает · цены из договора' : 'Ждёт цен по договору'}
            {!plan.operatorStatus?.applies && plan.operatorStatus?.reason && <span>{plan.operatorStatus.reason}</span>}
          </div>}
        </div>
        {plan.partnerId && (
          <div className={classes.planConditions}>
            {partnerConditions(plan, partners).map((c) => (
              <span key={c.label} className={classes.planCondition}>
                <span>{c.label}</span>{c.value}
              </span>
            ))}
          </div>
        )}
        {(canEdit || onOpenContract) && <div className={classes.planPanelActions}>
          {onOpenContract && <button type="button" className={classes.btnGhost} onClick={onOpenContract}>Открыть договор</button>}
          {canEdit && <button className={classes.iconBtn} title="Редактировать план" onClick={onEditPlan}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>}
        </div>}
      </div>

      <div className={classes.subTabs}>
        {plan.forOperator ? (
          <>
            <button className={[classes.subTab, tab === 'contract' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('contract')}>
              Цены договора
            </button>
            <button className={[classes.subTab, tab === 'calendar' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('calendar')}>
              Календарь
            </button>
          </>
        ) : (
          <>
            <button className={[classes.subTab, tab === 'standard' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('standard')}>
              Базовые цены
            </button>
            <button className={[classes.subTab, tab === 'seasons' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('seasons')}>
              Сезоны {seasonCount > 0 && <span className={classes.subTabBadge}>{seasonCount}</span>}
            </button>
            <button className={[classes.subTab, tab === 'calendar' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('calendar')}>
              Календарь
            </button>
          </>
        )}
      </div>

      {plan.parentRatePlanId && (
        <div className={classes.inheritedNote}>
          Этот план наследует цены от базового. Цены, заданные здесь, переопределяют унаследованные.
        </div>
      )}

      {plan.forOperator && tab === 'contract' && <ContractPricesTab key={contractViewKey(plan)} plan={plan} />}
      {plan.forOperator && tab === 'calendar' && <ContractCalendar key={contractViewKey(plan)} plan={plan} />}
      {!plan.forOperator && tab === 'standard' && <StandardPrices plan={plan} roomTypes={roomTypes} />}
      {!plan.forOperator && tab === 'seasons' && <Seasons plan={plan} roomTypes={roomTypes} />}
      {!plan.forOperator && tab === 'calendar' && <RateCalendar plan={plan} roomTypes={roomTypes} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Э6 · Цены договора с оператором (11.11.2026).
 *
 * Гостиница видит, по какой цене её посчитает оператор, — и не узнаёт об этом
 * из акта задним числом. Цена берётся из реестра договоров Kars Avia и здесь
 * только показывается: тариф по договору цен не вводит — он их берёт.
 *
 * Договор без приложения цен виден честно («цен нет»): тариф по нему завести
 * можно, он начнёт работать, когда цены придут.
 * ───────────────────────────────────────────────────────────────────────── */
const contractKey = (partnerId, number) => `${partnerId}|${number?.trim() ?? ''}`;

function OperatorContractPrices({ contracts, plans, partners, onCreatePlan, onOpenPlan, canEdit,
  openedContracts, onToggleContract, pinnedContract, onSearchChange, summaryRef }) {
  const [search, setSearch] = useState('');
  const [shownSlice, setShownSlice] = useState(null);
  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const matchesSearch = (c) => [c.number, c.account?.name].some((v) => v?.toLocaleLowerCase('ru-RU').includes(needle));
  const visible = contracts.filter((c) => matchesSearch(c) || contractKey(c.partnerId, c.number) === pinnedContract);
  const pinnedOutsideSearch = visible.some((c) => !matchesSearch(c));
  const customerName = (partner, code) =>
    (partner?.customers ?? []).find((c) => c.code === code)?.name ?? code ?? 'Все авиакомпании';
  const sliceLabel = (partner, s) =>
    [
      customerName(partner, s.customer),
      s.guestKind ? GUEST_KIND_SHORT[s.guestKind] : null,
      MEAL_PLAN_SHORT[s.mealPlan] ?? s.mealPlan,
    ]
      .filter(Boolean)
      .join(' · ');

  if (!contracts.length) return <div className={classes.emptyState}>
    <div className={classes.emptyTitle}>Договоров пока нет</div>
    <div className={classes.emptyText}>Договоры появятся после синхронизации с Kars Avia.</div>
  </div>;

  return (
    <div className={classes.sectionCard}>
      <div className={classes.contractRegistryHead}>
        <div className={classes.emptyHint}>Выберите договор и условия. Цены обновляются из реестра Kars Avia.</div>
        {(contracts.length > 3 || search) && <input className={classes.input} type="search" aria-label="Поиск договора по номеру или юрлицу" placeholder="Номер договора или юрлицо" value={search} onChange={(e) => {
          setSearch(e.target.value);
          onSearchChange();
        }} />}
      </div>
      {pinnedOutsideSearch && <div className={classes.contractNotice}>Договор открыт из тарифа. Поисковый запрос сохранён.</div>}
      {visible.length === 0 && <div className={classes.contractNotice}>Договоры не найдены. Измените поисковый запрос.</div>}
      {visible.map((c) => {
        const key = contractKey(c.partnerId, c.number);
        const isOpen = openedContracts.get(key) ?? Boolean(c.isPrimary || contracts.length === 1);
        const partner = partners.find((p) => p.id === c.partnerId) ?? null;
        const sliceOfPlan = (s) =>
          planForSlice(
            plans,
            {
              account: c.account,
              customer: s.customer ? { code: s.customer, name: customerName(partner, s.customer) } : null,
              guestKind: s.guestKind,
              mealPlan: s.mealPlan,
            },
            partner,
            c.number,
          );
        return (
          <details key={key} className={classes.contractGroup} open={isOpen}>
            <summary ref={key === pinnedContract ? summaryRef : undefined} className={classes.contractGroupHead} onClick={(event) => {
              event.preventDefault();
              onToggleContract(key, !isOpen);
            }}>
              <b>Договор {c.number}</b>
              {c.account && <span>{c.account.name}</span>}
              <span>
                {c.signedAt ? 'с ' + fmtDay(c.signedAt) : ''}
                {c.expiresAt ? ' по ' + fmtDay(c.expiresAt) : ''}
              </span>
              <span>{c.documents} документов</span>
              {c.isPrimary && <span className={classes.rowChip}>Рабочий</span>}
              {c.state === 'ARCHIVED' && <span className={classes.rowChip}>Архив</span>}
              <span className={classes.contractState}>{c.hasPrices ? 'Цены доступны' : 'Ждёт цен'}</span>
            </summary>
            {!c.hasPrices ? (
              <div className={classes.contractEmpty}>
                <div className={classes.emptyHint}>{contractAvailabilityText(c)}</div>
                {canEdit && <button className={classes.btnGhost} onClick={() => onCreatePlan(c, null)}>Создать тариф по договору</button>}
              </div>
            ) : (
              <ul className={classes.sliceList}>
                {c.slices.map((s) => {
                  const plan = sliceOfPlan(s);
                  const sliceKey = [key, s.customer, s.guestKind, s.mealPlan].join('|');
                  const previewForm = {
                    partnerId: c.partnerId, operatorContract: c.number,
                    partnerAccountId: partner?.accounts?.find((a) => a.code === c.account?.code)?.id ?? '',
                    partnerCustomerId: partner?.customers?.find((a) => a.code === s.customer)?.id ?? '',
                    guestKind: s.guestKind ?? '', mealPlan: s.mealPlan,
                  };
                  const missingDirectory = (s.customer && !previewForm.partnerCustomerId) || (c.account && !previewForm.partnerAccountId);
                  return (
                    <li key={s.customer + '|' + s.guestKind + '|' + s.mealPlan}>
                      <div className={classes.sliceSummary}>
                      <span>{sliceLabel(partner, s)}</span>
                      <div className={classes.sliceActions}>
                      <button className={classes.btnGhost} disabled={Boolean(missingDirectory)} aria-expanded={shownSlice === sliceKey} onClick={() => setShownSlice(shownSlice === sliceKey ? null : sliceKey)}>{shownSlice === sliceKey ? 'Скрыть цены' : 'Посмотреть цены'}</button>
                      {plan ? (
                        <>
                          <span className={classes.sliceOk}>{plan.name}</span>
                          <button type="button" className={classes.btnGhost} onClick={() => onOpenPlan(plan.id)}>Открыть тариф</button>
                        </>
                      ) : canEdit && (
                        <button className={classes.btnGhost} disabled={Boolean(missingDirectory)} onClick={() => onCreatePlan(c, s)}>
                          Завести тариф
                        </button>
                      )}
                      </div>
                      </div>
                      {missingDirectory && <div className={classes.fieldHint}>Для проверки цен диспетчеру нужно обновить справочник партнёра.</div>}
                      {shownSlice === sliceKey && <div className={classes.slicePreview}><ContractTariffPreview form={previewForm} /></div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tariffs (main)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_LABELS = { plans: 'Тарифы', contracts: 'Договоры партнёра' };
const EMPTY_CONTRACTS = [];

function Tariffs() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('rate.update');
  const planQuery = useRatePlans();
  const roomQuery = useTariffRoomTypes();
  const { data: plans = [], isLoading } = planQuery;
  const { data: roomTypes = [] } = roomQuery;
  const createPlan = useCreateRatePlan();
  const updatePlan = useUpdateRatePlan();
  const deletePlan = useDeleteRatePlan();

  /* Договоры из реестра Kars Avia: договор без цен тоже в списке — по нему
     тариф заводится и ждёт приложения. */
  const contractQuery = useContracts();
  const partnerQuery = usePartners();
  const { data: contracts = EMPTY_CONTRACTS } = contractQuery;
  const { data: partners = [] } = partnerQuery;

  const [activeSection, setActiveSection] = useState('plans');
  const [openedContracts, setOpenedContracts] = useState(() => new Map());
  const [pinnedContract, setPinnedContract] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);
  /* Срез договора, у которого нажали «Завести тариф»: мастер откроется с уже
     выбранными договором и срезом. */
  const [prefill, setPrefill] = useState(null);
  const [formError, setFormError] = useState(null);

  const tabId = useId();
  const scrollRoot = useRef(null);
  const tabs = useRef({});
  const planHeading = useRef(null);
  const contractSummary = useRef(null);
  const scrollPositions = useRef({ plans: 0, contracts: 0 });
  const navigation = useRef(null);

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? plans[0] ?? null;
  const selectedContract = selectedPlan?.forOperator && selectedPlan.partnerId && selectedPlan.operatorContract?.trim()
    ? contracts.find((c) => contractKey(c.partnerId, c.number) === contractKey(selectedPlan.partnerId, selectedPlan.operatorContract))
    : null;

  // Начальное раскрытие определяется при появлении договора. Поздние
  // изменения состава реестра не закрывают уже открытый предпросмотр.
  useLayoutEffect(() => {
    setOpenedContracts((current) => {
      let next = current;
      for (const c of contracts) {
        const key = contractKey(c.partnerId, c.number);
        if (next.has(key)) continue;
        if (next === current) next = new Map(current);
        next.set(key, Boolean(c.isPrimary || contracts.length === 1));
      }
      return next;
    });
  }, [contracts]);

  const switchSection = (section, focus = 'tab') => {
    if (section === activeSection) {
      if (focus === 'tab') tabs.current[section]?.focus({ preventScroll: true });
      return;
    }
    scrollPositions.current[activeSection] = scrollRoot.current?.scrollTop ?? 0;
    navigation.current = focus;
    setActiveSection(section);
  };

  useLayoutEffect(() => {
    const root = scrollRoot.current;
    const focus = navigation.current;
    if (!root || !focus) return;
    navigation.current = null;
    const target = focus === 'contract' ? contractSummary.current : focus === 'plan' ? planHeading.current : null;
    if (target) {
      const top = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
      root.scrollTop = Math.max(0, root.scrollTop + top - 12);
      target.focus({ preventScroll: true });
    } else {
      root.scrollTop = scrollPositions.current[activeSection];
      tabs.current[activeSection]?.focus({ preventScroll: true });
    }
  }, [activeSection]);

  const handleTabKey = (event) => {
    const other = activeSection === 'plans' ? 'contracts' : 'plans';
    const next = { ArrowLeft: other, ArrowRight: other, Home: 'plans', End: 'contracts' }[event.key];
    if (typeof next !== 'string') return;
    event.preventDefault();
    switchSection(next);
  };

  const setContractOpen = (key, open) => setOpenedContracts((current) => new Map(current).set(key, open));
  const openContract = (contract) => {
    const key = contractKey(contract.partnerId, contract.number);
    setPinnedContract(key);
    setContractOpen(key, true);
    switchSection('contracts', 'contract');
  };
  const openPlan = (id) => {
    setSelectedPlanId(id);
    switchSection('plans', 'plan');
  };

  const openNew  = () => { if (!canEdit) return; setFormError(null); setFormData(null); setPrefill(null); setShowForm(true); };
  const openEdit = (plan) => { if (!canEdit) return; setFormError(null); setFormData(plan); setPrefill(null); setShowForm(true); };
  const openForSlice = (contract, slice) => {
    if (!canEdit) return;
    setFormError(null);
    setFormData(null);
    setPrefill({ contract, slice });
    setShowForm(true);
  };

  /* Один сборщик тела для всех путей: поля цен и питания уходят только у
     своего тарифа, у корпоративного их нет вовсе (цены — из договора). */
  const payloadOf = (form) => ({
    code: form.code,
    name: form.name,
    description: form.description || null,
    mealPlan: form.mealPlan,
    isActive: form.isActive,
    forOperator: form.forOperator,
    parentRatePlanId: form.forOperator ? null : (form.parentRatePlanId || null),
    priceModifierType: !form.forOperator && form.parentRatePlanId ? form.priceModifierType : undefined,
    priceModifierValue:
      !form.forOperator && form.parentRatePlanId ? (form.priceModifierValue ?? 0) : undefined,
    ...(form.forOperator
      ? {
          operatorContract: form.operatorContract || null,
          partnerId: form.partnerId || undefined,
          partnerAccountId: form.partnerAccountId || null,
          partnerCustomerId: form.partnerCustomerId || null,
          guestKind: form.guestKind || null,
        }
      : { operatorContract: null, ...mealPayload(form) }),
  });

  const handleSave = async (form) => {
    if (!canEdit) return false;
    setFormError(null);
    /* id в форме — уже созданный тариф (свой тариф создаётся до шагов «Цены» и
       «Сезоны»): сохранение после этого — правка, а не второй тариф. */
    const planId = form.id || formData?.id;
    try {
      if (planId) {
        const updated = await updatePlan.mutateAsync({ id: planId, payload: payloadOf(form) });
        setShowForm(false);
        openPlan(updated?.id ?? planId);
        return updated ?? true;
      } else if (form.forOperator) {
        const created = await createPlan.mutateAsync(payloadOf(form));
        setShowForm(false);
        openPlan(created.id);
        return created;
      } else {
        /* Свой тариф: он нужен, чтобы показать шаги «Цены» и «Сезоны» в этом же
           окне. Возвращаем его форме — она сама перейдёт к ним. */
        return await createPlan.mutateAsync(payloadOf(form));
      }
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFormError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const handleDelete = async (id) => {
    if (!canEdit) return;
    await deletePlan.mutateAsync(id);
    setShowForm(false);
    if (selectedPlanId === id) setSelectedPlanId(null);
  };

  const isSaving = createPlan.isPending || updatePlan.isPending || deletePlan.isPending;

  if (isLoading || contractQuery.isLoading || partnerQuery.isLoading || roomQuery.isLoading) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}><div className={classes.pageTitle}>Тарифы</div></div>
        <div className={classes.loadingState}>Загрузка...</div>
      </div>
    );
  }

  const failedQueries = [planQuery, contractQuery, partnerQuery, roomQuery].filter((q) => q.isError);
  const retryQueries = () => Promise.all(failedQueries.map((q) => q.refetch()));
  if (failedQueries.some((q) => q.data == null)) {
    return <div className={classes.root}><div className={classes.pageTitle}>Тарифы</div>
      <ContractPriceNotice title="Не удалось загрузить тарифы и договоры" onRetry={retryQueries}>
        Повторите загрузку. Ошибка соединения не означает, что договоров нет.
      </ContractPriceNotice>
    </div>;
  }

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div><h1 className={classes.pageTitle}>Тарифы</h1>
          <div className={classes.pageSubtitle}>Цены гостиницы и условия размещения по договорам партнёров</div>
        </div>
      </div>

      <div className={classes.sectionNavigation}>
        <div className={classes.sectionTabs} role="tablist" aria-label="Разделы тарифов">
          {Object.entries(SECTION_LABELS).map(([section, label]) => (
            <button key={section} ref={(node) => { tabs.current[section] = node; }} type="button"
              id={`${tabId}-${section}-tab`} role="tab" aria-selected={activeSection === section}
              aria-controls={`${tabId}-${section}-panel`} tabIndex={activeSection === section ? 0 : -1}
              className={classes.sectionTab} onClick={() => switchSection(section)} onKeyDown={handleTabKey}>
              {label}<span className={classes.countBadge}>{section === 'plans' ? plans.length : contracts.length}</span>
            </button>
          ))}
        </div>
        {activeSection === 'plans' && canEdit && (
          <button type="button" className={classes.btnAdd} onClick={openNew}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Новый тариф
          </button>
        )}
      </div>

      <div ref={scrollRoot} className={classes.contentScroll}>
      {failedQueries.length > 0 && <ContractPriceNotice title="Не удалось обновить данные" onRetry={retryQueries}>
        Показаны последние загруженные данные. Введённые значения в мастере сохранены на экране.
      </ContractPriceNotice>}

      <section id={`${tabId}-plans-panel`} role="tabpanel" aria-labelledby={`${tabId}-plans-tab`}
        className={classes.sectionPanel} hidden={activeSection !== 'plans'}>
      {plans.length === 0 && (
        <div className={classes.emptyState}>
          <div className={classes.emptyIcon}>
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
          </div>
          <div className={classes.emptyTitle}>{canEdit ? 'Создайте первый тариф' : 'Тарифов пока нет'}</div>
          <div className={classes.emptyText}>
            {contracts.length
              ? (canEdit ? 'Создайте свой тариф или подготовьте тариф по договору.' : 'Договоры гостиницы доступны в соседней вкладке.')
              : (canEdit ? 'Создайте собственный тариф с ценами гостиницы.' : 'Здесь появятся тарифы гостиницы.')}
          </div>
          {contracts.length > 0 && <button type="button" className={classes.btnGhost} onClick={() => switchSection('contracts')}>Перейти к договорам</button>}
        </div>
      )}

      {plans.length > 0 && (
        <>
          <div className={classes.planTabsWrapper}>
            <div className={classes.planTabs}>
              {plans.map(p => (
                <button
                  type="button" aria-pressed={selectedPlan?.id === p.id}
                  key={p.id}
                  className={`${classes.planTab} ${selectedPlan?.id === p.id ? classes.planTabActive : ''}`}
                  onClick={() => setSelectedPlanId(p.id)}
                >
                  <div className={classes.planTabHead}>
                    <span className={classes.planTabName}>{p.name}</span>
                    {p.parentRatePlanId && <span className={classes.planTabInherits}>Наследует цены</span>}
                    {p.forOperator && (
                      <span className={classes.planTabCorp}>
                        {partners.find((x) => x.id === p.partnerId)?.name ?? 'Партнёр'}
                      </span>
                    )}
                    {!p.isActive && <span className={classes.rowChip}>Неактивен</span>}
                  </div>
                  <div className={classes.planTabMeta}>{p.code} · {MEAL_PLAN_LABELS[p.mealPlan] ?? p.mealPlan}</div>
                </button>
              ))}
              {canEdit && <button
                style={{ alignSelf: 'center', marginLeft: 4, background: 'none', border: '1px dashed #CBD5E1', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', color: '#94A3B8', fontSize: 13, fontFamily: 'inherit' }}
                onClick={openNew}
              >+ Добавить</button>}
            </div>
          </div>

          {selectedPlan && (
            <PlanPanel
              canEdit={canEdit}
              key={selectedPlan.id}
              plan={selectedPlan}
              roomTypes={roomTypes}
              partners={partners}
              onEditPlan={() => openEdit(selectedPlan)}
              onOpenContract={selectedContract ? () => openContract(selectedContract) : undefined}
              headingRef={planHeading}
            />
          )}
        </>
      )}
      </section>

      <section id={`${tabId}-contracts-panel`} role="tabpanel" aria-labelledby={`${tabId}-contracts-tab`}
        className={classes.sectionPanel} hidden={activeSection !== 'contracts'}>
        <OperatorContractPrices
          canEdit={canEdit}
          contracts={contracts}
          plans={plans}
          partners={partners}
          onCreatePlan={openForSlice}
          onOpenPlan={openPlan}
          openedContracts={openedContracts}
          onToggleContract={setContractOpen}
          pinnedContract={pinnedContract}
          onSearchChange={() => setPinnedContract(null)}
          summaryRef={contractSummary}
        />
      </section>
      </div>

      {canEdit && showForm && (
        <RatePlanForm
          plan={formData}
          prefill={prefill}
          allPlans={plans}
          contracts={contracts}
          partners={partners}
          roomTypes={roomTypes}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setShowForm(false); setFormError(null); setPrefill(null); }}
          saving={isSaving}
          error={formError}
        />
      )}
    </div>
  );
}

export default Tariffs;
