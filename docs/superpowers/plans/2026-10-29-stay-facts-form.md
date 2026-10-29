# Separate booked dates and stay facts

> **For agentic workers:** Execute inline using executing-plans. Production access is read-only.

**Goal:** Staff can record same-day checkout without editing the booked date interval.

**Architecture:** BookingForm displays the booked period and actual stay as separate blocks. A checkout button calls the existing POST check-out API with only the reservation id; existing server balance, status, housekeeping and partner-event rules remain authoritative. Reuse wall-time formatting. Disable checkout when form fields are dirty, and use the existing reload callbacks in both timeline and booking list.

**Tech Stack:** React 18, Vite, existing reservation API, node:test.

Approved by Musa: «Подходит, сделай так» on 29.10.2026. Worktree C:/dev/Kars-hotel-stay-facts, branch codex/pms-stay-facts, base origin/main 76f3ab2. No schema or pricing changes.

- [x] RED: extend Timeline/stayTimes.test.mjs to distinguish actual timestamps from planned arrival/departure, including same-day facts and missing facts.
- [x] Add `stayFacts(booking)` to stayTimes.js and reuse it in existing tooltip rows.
- [x] Add clearly labelled booking-period and actual-stay blocks to BookingForm.jsx, preserving the booked dates.
- [x] Add guarded checkout using existing api/reservations.checkOut and reservationErrorText. Require reservation.checkout, checked_in, clean form, and no pending save.
- [x] Wire `onChanged={reload}` in Timeline.jsx and Bookings.jsx; successful checkout closes and refreshes the card.
- [x] Run node:test, frontend lint and build. Check diff and verify no business data or production files were touched.
