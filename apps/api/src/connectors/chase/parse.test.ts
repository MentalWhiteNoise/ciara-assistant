import { test } from "node:test";
import assert from "node:assert/strict";
import { merchantName, parseChaseCsv } from "./parse.js";

const HEADER = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo";

test("parses rows, decodes entities, reads the card number from the file name", () => {
  const p = parseChaseCsv(
    [HEADER, "12/31/2024,12/31/2024,SQ *BLACK CAT BOOKS &amp; ODD,Shopping,Sale,-80.06,"].join("\n"),
    "Chase9762_Activity_20261115 (3).csv",
  );
  assert.equal(p.account, "9762");
  assert.deepEqual(p.rows[0], {
    externalId: "row:2024-12-31|2024-12-31|SQ *BLACK CAT BOOKS & ODD|-80.06#1",
    transactionDate: "2024-12-31",
    postDate: "2024-12-31",
    description: "SQ *BLACK CAT BOOKS & ODD",
    chaseCategory: "Shopping",
    type: "Sale",
    amount: -80.06,
    memo: null,
  });
});

test("identical rows in one file are kept as #1 and #2; overlapping files agree on IDs", () => {
  const row = "11/12/2026,11/13/2026,STARBUCKS,Food & Drink,Sale,-5.25,";
  const a = parseChaseCsv([HEADER, row, row].join("\n"));
  const b = parseChaseCsv([HEADER, "11/14/2026,11/15/2026,OTHER,Shopping,Sale,-1.00,", row, row].join("\r\n"));
  assert.deepEqual(a.rows.map((r) => r.externalId.slice(-2)), ["#1", "#2"]);
  const ids = new Set([...a.rows, ...b.rows].map((r) => r.externalId));
  assert.equal(ids.size, 3); // OTHER + STARBUCKS#1 + STARBUCKS#2
});

test("rejects files that aren't Chase card activity", () => {
  assert.throws(() => parseChaseCsv("Date,Amount\n1/1/2025,5"), /Chase credit card activity/);
});

test("merchant names drop order codes and store numbers", () => {
  const cases: [string, string][] = [
    ["AMAZON MKTPL*WX4JU99J3", "AMAZON MKTPL"],
    ["Amazon.com*ZE9504722", "AMAZON.COM"],
    ["SQSP* INV171129666", "SQSP"],
    ["SQSP* WEBSIT#217312911", "SQSP *WEBSIT"],
    ["SHELL OIL 57545151706", "SHELL OIL"],
    ["PETSMART # 0529", "PETSMART"],
    ["HOBBY-LOBBY #948", "HOBBY-LOBBY"],
    ["3285 GET GO CAFE &amp; MARKET", "GET GO CAFE & MARKET"],
    ["DD *DOORDASH LEOSITALI", "DD *DOORDASH LEOSITALI"],
    ["DNH*GODADDY#3919971389", "DNH *GODADDY"],
    ["LIGHTNINGSRC/INGRAMSPARK", "LIGHTNINGSRC/INGRAMSPARK"],
    ["48 HR BOOKS", "48 HR BOOKS"],
    ["7-ELEVEN 3M", "7-ELEVEN 3M"],
  ];
  for (const [input, expected] of cases) assert.equal(merchantName(input), expected, input);
});
