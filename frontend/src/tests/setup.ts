// Vitest setup. Runs before every test file.
//
// The date helpers work in local time, so the suite pins the timezone to UTC
// to keep assertions readable and machine-independent. Node re-reads TZ when
// it changes, so setting it here is enough.
process.env.TZ = "UTC";

import "@testing-library/jest-dom/vitest";
