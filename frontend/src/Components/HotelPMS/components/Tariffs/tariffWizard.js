/** Ошибка шага останавливает переход; окно закрывается только после всех записей. */
export async function saveWizardSteps(steps, savePlan = async () => true) {
  for (const { step, save } of steps) {
    if (!(await save())) return { saved: false, step };
  }
  return (await savePlan()) ? { saved: true } : { saved: false, step: 0 };
}
