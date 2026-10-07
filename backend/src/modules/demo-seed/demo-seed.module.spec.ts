import { DemoSeedModule, demoSeedModules } from './demo-seed.module';

/* 152-ФЗ, Т-71; план 12.9: на бою ручек demo-seed нет вовсе. */
describe('demoSeedModules', () => {
  it('на бою — ни одного модуля', () => {
    expect(demoSeedModules('production')).toEqual([]);
  });

  it('в разработке и тестах — есть', () => {
    expect(demoSeedModules('development')).toEqual([DemoSeedModule]);
    expect(demoSeedModules(undefined)).toEqual([DemoSeedModule]);
  });
});
