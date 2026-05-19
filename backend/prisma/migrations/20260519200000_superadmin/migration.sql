-- Migration: add SUPER_ADMIN role code
-- PostgreSQL supports ADD VALUE IF NOT EXISTS for enums (safe to re-run)
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
