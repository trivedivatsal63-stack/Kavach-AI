import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { signJwt } from "../auth";

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");
  const name = String(req.body?.name ?? "").trim();

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  if (password.length < 8) {
    res
      .status(400)
      .json({ error: "Password must be at least 8 characters." });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, hashedPassword, name: name || null },
  });

  const token = signJwt({ userId: user.id });
  res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      creditBalanceUsd: user.creditBalanceUsd.toNumber(),
    },
  });
});

authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);
  if (!passwordsMatch) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = signJwt({ userId: user.id });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      creditBalanceUsd: user.creditBalanceUsd.toNumber(),
    },
  });
});
