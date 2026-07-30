export const API_BASE_URL = "https://kitchendesk.chefplan.ru";
export const LOGIN_URL = `${API_BASE_URL}/web-login/`;
export const TELEGRAM_BOT_URL = "https://t.me/KitchenDeskOfficialBot";

export class ApiError extends Error {}

export interface RegisterLandingPayload {
  restaurant_name: string;
  name: string;
  phone: string;
}

export interface RegisterLandingResponse {
  token: string;
}

export interface RegisterStatusResponse {
  status: string;
}

async function parseJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function registerLanding(
  payload: RegisterLandingPayload,
): Promise<RegisterLandingResponse> {
  const res = await fetch(`${API_BASE_URL}/api/landing/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(data.error ?? "Не удалось отправить заявку");
  }
  return data;
}

export async function getRegisterStatus(token: string): Promise<RegisterStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/api/landing/register-status/${token}`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(data.error ?? "Заявка не найдена");
  }
  return data;
}

export interface FaqEntry {
  id: number;
  question: string;
  answer: string;
  sort_order: number;
}

export async function getLandingFaq(): Promise<FaqEntry[]> {
  const res = await fetch(`${API_BASE_URL}/api/landing/faq`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(data.error ?? "Не удалось загрузить FAQ");
  }
  return Array.isArray(data) ? data : (data.items ?? []);
}
