import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';
import { UpdateRoomDto } from './update-room.dto';

/* Номер номера — до 100 символов (22.10.2026). Перенесённые из старой системы
 * номера бывают адресом квартиры, и при прежнем пределе 16 такой номер нельзя
 * было даже пересохранить. */

const ROOM_TYPE = '7d9f4c2e-1b3a-4c5d-8e6f-0a1b2c3d4e5f';
const APARTMENT = 'ул. 40 лет Победы 3 кв 58, подъезд 2, этаж 5, вход со двора';
const numberErrors = (cls: typeof CreateRoomDto | typeof UpdateRoomDto, number: string) =>
  validateSync(plainToInstance(cls, { roomTypeId: ROOM_TYPE, number })).filter((e) => e.property === 'number');

describe('номер номера — длина', () => {
  it('адрес квартиры длиннее 16 — проходит и при заведении, и при правке', () => {
    expect(APARTMENT.length).toBeGreaterThan(16);
    expect(numberErrors(CreateRoomDto, APARTMENT)).toEqual([]);
    expect(numberErrors(UpdateRoomDto, APARTMENT)).toEqual([]);
  });

  it('100 символов — можно, 101 — НЕТ', () => {
    expect(numberErrors(CreateRoomDto, 'a'.repeat(100))).toEqual([]);
    expect(numberErrors(CreateRoomDto, 'a'.repeat(101))).not.toEqual([]);
    expect(numberErrors(UpdateRoomDto, 'a'.repeat(101))).not.toEqual([]);
  });
});
