import { prisma } from "../models/prisma";
import { AppError } from "../middleware/errorHandler";
import { USER_STATUS } from "../utils/roles";

/** Login/session: blocked and deleted accounts cannot obtain or keep a JWT. */
export function assertCanAuthenticate(user: {
  status: string;
  deletedAt: Date | null;
}): void {
  if (user.deletedAt) {
    throw new AppError(401, "Invalid email or password.");
  }
  if (user.status === USER_STATUS.BLOCKED) {
    throw new AppError(403, "This account has been blocked.");
  }
}

/**
 * Inference and other spend-creating actions. Paused users may still log in
 * and read their dashboard, but they cannot chat, mint keys, or call the API.
 */
export function assertCanAct(user: {
  status: string;
  deletedAt: Date | null;
}): void {
  if (user.deletedAt) {
    throw new AppError(403, "This account has been deleted.");
  }
  if (user.status === USER_STATUS.BLOCKED) {
    throw new AppError(403, "This account has been blocked.");
  }
  if (user.status === USER_STATUS.PAUSED) {
    throw new AppError(
      403,
      "This account is paused. Contact an administrator."
    );
  }
}

export async function assertUserCanAct(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
  if (!user) {
    throw new AppError(401, "Invalid or expired token");
  }
  assertCanAct(user);
}
