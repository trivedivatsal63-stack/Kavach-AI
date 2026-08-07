require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

p.$queryRawUnsafe("SELECT 1 as ok")
  .then((r) => {
    console.log("DB OK", r);
    return p.user.count();
  })
  .then((c) => {
    console.log("users", c);
    return p.$disconnect();
  })
  .catch(async (e) => {
    console.error("DB FAIL", e.message);
    await p.$disconnect().catch(() => {});
    process.exit(1);
  });
