import { SERVER_URL } from "./config";
import logger from "./log";
import { botAxios } from "./network";

interface LoginInfoResponse {
    data?: {
        user_id?: number,
        nickname?: string,
    },
}

interface LoginInfo {
    userId: number | null;
    nickname: string | null;
}

const loginInfo: LoginInfo = {
    userId: null,
    nickname: null,
};

export const initLoginInfo = async (): Promise<void> => {
    try {
        const response = await botAxios.post<LoginInfoResponse>(`${SERVER_URL}/get_login_info`, {});
        const userId = response.data.data?.user_id;
        const nickname = response.data.data?.nickname?.trim();
        if (typeof userId === "number") {
            loginInfo.userId = userId;
            loginInfo.nickname = nickname || null;
            logger.info({ userId, nickname: loginInfo.nickname }, "Loaded login info");
        } else {
            logger.warn("Failed to load login info: invalid response");
        }
    } catch (error) {
        logger.warn({ error }, "Failed to load login info");
    }
};

export const getLoginUserId = (): number | null => loginInfo.userId;

export const getLoginNickname = (): string => loginInfo.nickname || "田园猫";
