//! 这个文件完全由 AI 生成

/**
 * 接口根结构
 */
export interface ThreadResponse {
    success: boolean;
    data: Thread;
}

/**
 * 帖子的主体数据内容
 */
export interface Thread {
    gid: number;
    anony: boolean;
    reid: number;
    time: string;
    title: string;
    board: Board;
    articles: Article[];
    head: ThreadHead;
    popularReplies: PopularReply[];
    pagination: Pagination;
}

/**
 * 版块信息
 */
export interface Board {
    name: string; // 板块英文名
    manager: string; // 版主用户名，以空格分隔
    description: string; // 板块中文名
    class: string; // 分类？如 "[生活]"
    section: string;
    is_favorite: boolean;
    threads_today_count: number;
    allow_attachment: boolean;
}

/**
 * 楼主帖子头部信息摘要
 */
export interface ThreadHead {
    id: number;
    time: string;
    voted: boolean;
    voteddown: boolean;
    promed: string | null;
    voteup_count: string; // 字符串形式的数字，如 "139"
    votedown_count: string;
    poster: Poster | PosterIwhisper;
}

/**
 * 每一层楼（回帖或主帖）的具体内容
 */
export interface Article {
    id: number;       // 帖子 ID；若是主帖则与 ThreadHead.id 相同
    op: boolean;      // 不懂。找到的例子里全是 false。
    time: string;     // 发布时间，如 "2025-04-27"
    pos: number;      // 楼层数，0 为主铁
    content: string;  // HTML 格式的帖子内容
    subject: boolean; // 是否为主帖
    voted: boolean;
    promed: string | null; // ？？慎用
    voteup_count: string;
    voteddown: boolean;
    votedown_count: string;
    votedown_min: number;
    poster: Poster | PosterIwhisper;
}

/**
 * 热门回复
 */
export interface PopularReply {
    id: number;
    pos: number;
    time: string;
    content: string;
    flag: string;
    voted: boolean;
    voteddown: boolean;
    voteup_count: string;
    votedown_count: string;
    poster: Poster | PosterIwhisper;
}

/**
 * 用户/发帖人信息（在主帖、回帖、热门回复中高度复用）
 */
export interface Poster {
    id: string;
    user_name: string;
    face_url: string;
    face_width: number;
    face_height: number;
    gender: 'm' | 'f' | 'n'; // m:男, f:女, n:未知/保密
    astro: string;
    life: number;
    qq: string;
    msn: string;
    home_page: string;
    level: string; // 例如: "用户", "版主"
    is_online: boolean;
    post_count: number;
    last_login_time: number; // 时间戳
    last_login_ip: string;
    is_hide: boolean;
    is_register: boolean;
    score: number;
    follow_num: number;
    fans_num: number;
    is_follow: boolean;
    is_fan: boolean;
}

export interface PosterIwhisper {
    id: string;
}

/**
 * 分页信息
 */
export interface Pagination {
    current: number;
    total: number;
}