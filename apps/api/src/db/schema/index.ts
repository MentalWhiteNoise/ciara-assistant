// All schema tables — Drizzle reads this to know what tables exist.
// Order matters for FK resolution: define referenced tables before referencing ones.

export * from "./users";
export * from "./categories";   // also exports: channels
export * from "./products";
export * from "./projects";
export * from "./calendar";     // also exports: eventTypes
export * from "./tasks";        // also exports: taskTemplates
export * from "./transactions"; // also exports: attachments
export * from "./inventory";    // also exports: inventoryMovements
export * from "./assets";       // also exports: mileageLogs
export * from "./sync";         // also exports: importDedupLog
