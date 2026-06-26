# Plan C: Team Management (API + UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let hotel owners manage their staff inside the PMS — invite users, change roles, deactivate accounts — without using the super-admin panel.

**Architecture:** Extend `TenantController` with 4 new endpoints (`GET/POST/PATCH/DELETE /tenant/users`). Add a new "Команда" screen in the PMS sidebar. Passwords for invited users are set on first login via a temporary random password (sent or displayed). No email service yet — password shown once at creation.

**Tech Stack:** NestJS, `PrismaService.admin`, `bcryptjs`, existing `TenantModule`; React + existing modal/table patterns.

**Depends on:** Plan A (PermissionsGuard must exist to protect new endpoints with `user.invite` / `user.update` / `user.delete` permissions).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `backend/src/modules/tenant/dto/manage-user.dto.ts` | DTOs for create/update user |
| Modify | `backend/src/modules/tenant/tenant.service.ts` | Add user management methods |
| Modify | `backend/src/modules/tenant/tenant.controller.ts` | Add user CRUD endpoints |
| Create | `frontend/src/api/tenantUsers.js` | API client calls |
| Create | `frontend/src/hooks/api/useTenantUsers.js` | React Query hook |
| Create | `frontend/src/Components/HotelPMS/components/Team/Team.jsx` | Team management screen |
| Create | `frontend/src/Components/HotelPMS/components/Team/InviteUserModal.jsx` | Invite user modal |
| Modify | `frontend/src/Components/HotelPMS/constants.js` | Add "Команда" to NAV_ITEMS |
| Modify | `frontend/src/Components/HotelPMS/HotelPMS.jsx` | Route "команда" to Team component |

---

## Task 1: Create DTOs for user management

**Files:**
- Create: `backend/src/modules/tenant/dto/manage-user.dto.ts`

- [ ] **Step 1: Write DTOs**

```typescript
// backend/src/modules/tenant/dto/manage-user.dto.ts
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantUserDto {
  @ApiProperty({ example: 'ivan@hotel.ru' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Иван Петров' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ description: 'Role ID to assign', example: 'uuid-of-front-desk-role' })
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({ description: 'Initial password (min 8 chars). If omitted, a random one is generated and returned.', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateTenantUserDto {
  @ApiPropertyOptional({ description: 'New role ID' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Activate or deactivate the user' })
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'New full name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/tenant/dto/manage-user.dto.ts
git commit -m "feat(team): add user management DTOs"
```

---

## Task 2: Add user management methods to `TenantService`

**Files:**
- Modify: `backend/src/modules/tenant/tenant.service.ts`

Read the existing file first, then add these methods:

- [ ] **Step 1: Add `listUsers()` method**

```typescript
// Add to TenantService:
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';

async listUsers(tenantId: string) {
  const users = await this.prisma.admin.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      role: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return users;
}
```

- [ ] **Step 2: Add `createUser()` method**

```typescript
async createUser(tenantId: string, dto: CreateTenantUserDto): Promise<{ id: string; email: string; temporaryPassword?: string }> {
  const normalizedEmail = dto.email.toLowerCase();

  // Verify role belongs to this tenant
  const role = await this.prisma.admin.role.findFirst({
    where: { id: dto.roleId, tenantId },
  });
  if (!role) {
    throw new NotFoundException('Role not found in this tenant');
  }
  if (role.code === 'OWNER' || role.code === 'SUPER_ADMIN') {
    throw new ForbiddenException('Cannot assign OWNER or SUPER_ADMIN role via team management');
  }

  const existing = await this.prisma.admin.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw new ConflictException('This email is already registered');
  }

  const temporaryPassword = dto.password ?? crypto.randomBytes(8).toString('hex');
  const rounds = 10;
  const passwordHash = await bcrypt.hash(temporaryPassword, rounds);

  const user = await this.prisma.admin.user.create({
    data: {
      tenantId,
      email: normalizedEmail,
      passwordHash,
      fullName: dto.fullName,
      roleId: dto.roleId,
    },
    select: { id: true, email: true },
  });

  // Return temporary password only if it was auto-generated
  return dto.password
    ? { id: user.id, email: user.email }
    : { id: user.id, email: user.email, temporaryPassword };
}
```

- [ ] **Step 3: Add `updateUser()` method**

```typescript
async updateUser(tenantId: string, userId: string, dto: UpdateTenantUserDto) {
  const user = await this.prisma.admin.user.findFirst({
    where: { id: userId, tenantId },
    include: { role: { select: { code: true } } },
  });
  if (!user) throw new NotFoundException('User not found');
  if (user.role.code === 'OWNER') throw new ForbiddenException('Cannot modify the OWNER account');

  if (dto.roleId) {
    const role = await this.prisma.admin.role.findFirst({
      where: { id: dto.roleId, tenantId },
    });
    if (!role) throw new NotFoundException('Role not found in this tenant');
    if (role.code === 'OWNER' || role.code === 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot assign OWNER or SUPER_ADMIN role');
    }
  }

  const updated = await this.prisma.admin.user.update({
    where: { id: userId },
    data: {
      ...(dto.roleId ? { roleId: dto.roleId } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.fullName ? { fullName: dto.fullName } : {}),
    },
    select: { id: true, email: true, fullName: true, isActive: true, role: { select: { id: true, code: true, name: true } } },
  });
  return updated;
}
```

- [ ] **Step 4: Add `deleteUser()` method**

```typescript
async deleteUser(tenantId: string, userId: string) {
  const user = await this.prisma.admin.user.findFirst({
    where: { id: userId, tenantId },
    include: { role: { select: { code: true } } },
  });
  if (!user) throw new NotFoundException('User not found');
  if (user.role.code === 'OWNER') throw new ForbiddenException('Cannot delete the OWNER account');

  // Soft-delete: deactivate instead of hard delete (preserves audit log references)
  await this.prisma.admin.user.update({
    where: { id: userId },
    data: { isActive: false },
  });
  return { deleted: true, id: userId };
}
```

- [ ] **Step 5: Add missing imports to tenant.service.ts**

Ensure these are imported at the top:
```typescript
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';
```

- [ ] **Step 6: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tenant/tenant.service.ts
git commit -m "feat(team): add listUsers, createUser, updateUser, deleteUser to TenantService"
```

---

## Task 3: Add user management endpoints to `TenantController`

**Files:**
- Modify: `backend/src/modules/tenant/tenant.controller.ts`

- [ ] **Step 1: Read current controller and add endpoints**

Add after the existing settings endpoints:

```typescript
// In TenantController, add:
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';

// Add endpoints to the class:

@Get('users')
@HttpCode(HttpStatus.OK)
@RequirePermissions('user.read')
@ApiOperation({ summary: 'List all users in this hotel' })
listUsers(@CurrentUser() user: AuthenticatedRequestUser) {
  return this.tenantService.listUsers(user.tenantId);
}

@Post('users')
@HttpCode(HttpStatus.CREATED)
@RequirePermissions('user.invite')
@ApiOperation({ summary: 'Invite a new user to this hotel' })
createUser(
  @CurrentUser() user: AuthenticatedRequestUser,
  @Body() dto: CreateTenantUserDto,
) {
  return this.tenantService.createUser(user.tenantId, dto);
}

@Patch('users/:userId')
@HttpCode(HttpStatus.OK)
@RequirePermissions('user.update')
@ApiOperation({ summary: 'Update role or active status of a team member' })
updateUser(
  @CurrentUser() user: AuthenticatedRequestUser,
  @Param('userId') userId: string,
  @Body() dto: UpdateTenantUserDto,
) {
  return this.tenantService.updateUser(user.tenantId, userId, dto);
}

@Delete('users/:userId')
@HttpCode(HttpStatus.OK)
@RequirePermissions('user.delete')
@ApiOperation({ summary: 'Deactivate a team member (soft delete)' })
deleteUser(
  @CurrentUser() user: AuthenticatedRequestUser,
  @Param('userId') userId: string,
) {
  return this.tenantService.deleteUser(user.tenantId, userId);
}
```

Also add a `GET /tenant/roles` endpoint so the frontend can populate the role dropdown:

```typescript
@Get('roles')
@HttpCode(HttpStatus.OK)
@RequirePermissions('user.read')
@ApiOperation({ summary: 'List roles available in this hotel' })
async listRoles(@CurrentUser() user: AuthenticatedRequestUser) {
  const roles = await this.tenantService.listRoles(user.tenantId);
  return roles;
}
```

Add `listRoles()` to `TenantService`:
```typescript
async listRoles(tenantId: string) {
  return this.prisma.admin.role.findMany({
    where: { tenantId, code: { not: 'SUPER_ADMIN' } },
    select: { id: true, code: true, name: true, isSystem: true },
    orderBy: { code: 'asc' },
  });
}
```

- [ ] **Step 2: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/tenant/tenant.controller.ts backend/src/modules/tenant/tenant.service.ts
git commit -m "feat(team): add GET/POST/PATCH/DELETE /tenant/users and GET /tenant/roles endpoints"
```

---

## Task 4: Add `user.*` permissions to `auth.constants.ts`

**Files:**
- Modify: `backend/src/modules/auth/auth.constants.ts`

- [ ] **Step 1: Read the constants file and verify `user.read`, `user.invite`, `user.update`, `user.delete` exist**

```bash
grep "user\." backend/src/modules/auth/auth.constants.ts
```

If missing, add them to `SYSTEM_PERMISSIONS` array:
```typescript
{ code: 'user.read',   name: 'Просмотр команды' },
{ code: 'user.invite', name: 'Приглашение сотрудников' },
{ code: 'user.update', name: 'Редактирование сотрудников' },
{ code: 'user.delete', name: 'Деактивация сотрудников' },
```

And add them to `DEFAULT_ROLE_PERMISSIONS`:
- `OWNER`: add all 4
- `MANAGER`: add `user.read`, `user.invite`, `user.update` (not `user.delete`)

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/auth/auth.constants.ts
git commit -m "feat(team): add user.* permissions to SYSTEM_PERMISSIONS and role defaults"
```

---

## Task 5: Create frontend API client and hook

**Files:**
- Create: `frontend/src/api/tenantUsers.js`
- Create: `frontend/src/hooks/api/useTenantUsers.js`

- [ ] **Step 1: Create API client**

```javascript
// frontend/src/api/tenantUsers.js
import client from './client';

export const getUsers = () =>
  client.get('/tenant/users').then((r) => r.data);

export const getRoles = () =>
  client.get('/tenant/roles').then((r) => r.data);

export const createUser = (data) =>
  client.post('/tenant/users', data).then((r) => r.data);

export const updateUser = (userId, data) =>
  client.patch(`/tenant/users/${userId}`, data).then((r) => r.data);

export const deleteUser = (userId) =>
  client.delete(`/tenant/users/${userId}`).then((r) => r.data);
```

- [ ] **Step 2: Create hook**

Read an existing hook (e.g., `useRooms.js`) to see the pattern, then:

```javascript
// frontend/src/hooks/api/useTenantUsers.js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, deleteUser, getRoles, getUsers, updateUser } from '../../api/tenantUsers';

export function useTenantUsers() {
  return useQuery({ queryKey: ['tenantUsers'], queryFn: getUsers });
}

export function useTenantRoles() {
  return useQuery({ queryKey: ['tenantRoles'], queryFn: getRoles });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenantUsers'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, data }) => updateUser(userId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenantUsers'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenantUsers'] }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/tenantUsers.js frontend/src/hooks/api/useTenantUsers.js
git commit -m "feat(team): add tenantUsers API client and hooks"
```

---

## Task 6: Create `Team.jsx` screen

**Files:**
- Create: `frontend/src/Components/HotelPMS/components/Team/Team.jsx`

- [ ] **Step 1: Read an existing screen for styling patterns**

Read `frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx` to understand the layout/table pattern used in this project.

- [ ] **Step 2: Write `Team.jsx`**

```jsx
// frontend/src/Components/HotelPMS/components/Team/Team.jsx
import { useState } from 'react';
import { useTenantUsers, useDeleteUser } from '../../../../hooks/api/useTenantUsers';
import InviteUserModal from './InviteUserModal';

const ROLE_LABELS = {
  OWNER: 'Владелец',
  MANAGER: 'Менеджер',
  FRONT_DESK: 'Портье',
  HOUSEKEEPING: 'Горничная',
  ACCOUNTANT: 'Бухгалтер',
  CHANNEL_MANAGER: 'Channel Manager',
  READ_ONLY: 'Только чтение',
};

export default function Team() {
  const { data: users = [], isLoading } = useTenantUsers();
  const deleteMutation = useDeleteUser();
  const [showInvite, setShowInvite] = useState(false);

  const handleDeactivate = async (userId) => {
    if (!window.confirm('Деактивировать сотрудника?')) return;
    await deleteMutation.mutateAsync(userId);
  };

  if (isLoading) return <div className="p-6">Загрузка...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Команда</h1>
        <button
          onClick={() => setShowInvite(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Пригласить сотрудника
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Сотрудник</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Роль</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Статус</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Последний вход</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{user.fullName}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{user.email}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700">
                    {ROLE_LABELS[user.role.code] ?? user.role.name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {user.isActive ? 'Активен' : 'Деактивирован'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('ru-RU') : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {user.role.code !== 'OWNER' && user.isActive && (
                    <button
                      onClick={() => handleDeactivate(user.id)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Деактивировать
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Components/HotelPMS/components/Team/Team.jsx
git commit -m "feat(team): add Team management screen"
```

---

## Task 7: Create `InviteUserModal.jsx`

**Files:**
- Create: `frontend/src/Components/HotelPMS/components/Team/InviteUserModal.jsx`

- [ ] **Step 1: Read `RoomFormModal.jsx` for existing modal pattern**

- [ ] **Step 2: Write `InviteUserModal.jsx`**

```jsx
// frontend/src/Components/HotelPMS/components/Team/InviteUserModal.jsx
import { useState } from 'react';
import Modal from '../../shared/Modal';
import { useCreateUser, useTenantRoles } from '../../../../hooks/api/useTenantUsers';

export default function InviteUserModal({ onClose }) {
  const { data: roles = [] } = useTenantRoles();
  const createMutation = useCreateUser();
  const [form, setForm] = useState({ email: '', fullName: '', roleId: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await createMutation.mutateAsync(form);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message ?? 'Ошибка при создании пользователя');
    }
  };

  if (result) {
    return (
      <Modal onClose={onClose} title="Сотрудник добавлен">
        <div className="space-y-3">
          <p><strong>Email:</strong> {result.email}</p>
          {result.temporaryPassword && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm font-medium text-yellow-800">Временный пароль (показывается один раз):</p>
              <code className="text-lg font-mono text-yellow-900">{result.temporaryPassword}</code>
            </div>
          )}
          <p className="text-sm text-gray-500">Передайте эти данные сотруднику. При первом входе он сможет сменить пароль.</p>
          <button onClick={onClose} className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg">
            Закрыть
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Пригласить сотрудника">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Email *</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="portye@hotel.ru"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Имя и фамилия *</label>
          <input
            type="text"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Иван Петров"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Роль *</label>
          <select
            required
            value={form.roleId}
            onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Выберите роль...</option>
            {roles.filter(r => r.code !== 'OWNER').map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm">
            Отмена
          </button>
          <button type="submit" disabled={createMutation.isPending} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            {createMutation.isPending ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Components/HotelPMS/components/Team/InviteUserModal.jsx
git commit -m "feat(team): add InviteUserModal with temporary password display"
```

---

## Task 8: Wire Team into the PMS navigation

**Files:**
- Modify: `frontend/src/Components/HotelPMS/constants.js`
- Modify: `frontend/src/Components/HotelPMS/HotelPMS.jsx`

- [ ] **Step 1: Read `constants.js` and add Team nav item**

Open `constants.js`, find `NAV_ITEMS` array, and add:
```javascript
{ id: 'team', label: 'Команда', icon: 'Users' },
```
Place it after "settings" or after "reports" — before the last item.

- [ ] **Step 2: Read `HotelPMS.jsx` and add Team route**

Find the switch/conditional that renders components per active section, and add:
```jsx
import Team from './components/Team/Team';
// In the render switch:
case 'team': return <Team />;
// or if it's an object map:
team: <Team />,
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Components/HotelPMS/constants.js \
        frontend/src/Components/HotelPMS/HotelPMS.jsx
git commit -m "feat(team): add Команда to PMS navigation"
```

---

## Self-Review Checklist

- [x] Spec coverage: Tasks 2, 3, 4 fully covered (user management API + UI, invite flow)
- [x] OWNER account protected from modification and deletion
- [x] SUPER_ADMIN role cannot be assigned via this API
- [x] Temporary password shown once at creation (no email service needed yet)
- [x] Soft-delete (deactivation) preserves audit log references
- [x] `@RequirePermissions` on all new endpoints (`user.read/invite/update/delete`)
- [x] GET /tenant/roles enables role dropdown in the UI
