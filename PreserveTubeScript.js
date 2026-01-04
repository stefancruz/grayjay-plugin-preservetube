const PLATFORM = "PreserveTube";
const PLATFORM_BASE_URL = "https://preservetube.com";

// URL patterns - PreserveTube
const REGEX_VIDEO_URL = /https:\/\/preservetube\.com\/watch\?v=([\w\-_]{11})/;
const REGEX_CHANNEL_URL = /https:\/\/preservetube\.com\/channel\/(@?[\w\-_]+)/;
const REGEX_CHANNEL_VIDEOS_URL = /https:\/\/preservetube\.com\/channel\/(@?[\w\-_]+)\/videos/;

// URL patterns - YouTube Video (to fetch archived versions)
// Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/v/,
//           youtube.com/shorts/, music.youtube.com/watch?v=
const REGEX_YOUTUBE_VIDEO_WATCH = /https?:\/\/(?:www\.|music\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w\-_]{11})/;
const REGEX_YOUTUBE_VIDEO_SHARE = /https?:\/\/youtu\.be\/([\w\-_]{11})/;
const REGEX_YOUTUBE_VIDEO_EMBED = /https?:\/\/(?:www\.)?youtube\.com\/embed\/([\w\-_]{11})/;
const REGEX_YOUTUBE_VIDEO_V = /https?:\/\/(?:www\.)?youtube\.com\/v\/([\w\-_]{11})/;
const REGEX_YOUTUBE_VIDEO_SHORTS = /https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([\w\-_]{11})/;

// URL patterns - YouTube Channel
// Supports: youtube.com/channel/UCxxx, youtube.com/@handle, youtube.com/c/name, youtube.com/user/name
const REGEX_YOUTUBE_CHANNEL_ID = /https?:\/\/(?:www\.|m\.)?youtube\.com\/channel\/(UC[\w\-_]{22})/;
const REGEX_YOUTUBE_CHANNEL_HANDLE = /https?:\/\/(?:www\.|m\.)?youtube\.com\/@([\w\-_.]+)/;
const REGEX_YOUTUBE_CHANNEL_CUSTOM = /https?:\/\/(?:www\.|m\.)?youtube\.com\/c\/([^\/\?]+)/;
const REGEX_YOUTUBE_CHANNEL_USER = /https?:\/\/(?:www\.|m\.)?youtube\.com\/user\/([^\/\?]+)/;

// State
let config = {};
let _settings = {};
let state = {
    channelCache: {}
};

// Source: Enable
source.enable = function(conf, settings, savedState) {
    config = conf ?? {};
    _settings = settings ?? {};

    if (savedState) {
        try {
            state = JSON.parse(savedState);
        } catch (e) {
            log("Failed to parse saved state: " + e.message);
        }
    }

    log("PreserveTube plugin enabled");
};

// Source: Disable
source.disable = function() {
    log("PreserveTube plugin disabled");
};

// Source: Save State
source.saveState = function() {
    return JSON.stringify(state);
};

// Source: Get Home (Latest videos)
source.getHome = function() {
    const url = `${PLATFORM_BASE_URL}/latest`;
    const html = makeGetRequest(url, false);

    if (!html) {
        return new VideoPager([], false);
    }

    const videoCards = parseVideoCardsFromHtml(html);
    const videos = [];

    for (const card of videoCards) {
        // Use channel info extracted from within the video card
        const author = card.channel
            ? createAuthorLink(card.channel.id, card.channel.name, card.channel.url, card.channel.avatar)
            : createAuthorLink("unknown", "Unknown", null, "");

        videos.push(new PlatformVideo({
            id: createPlatformID(card.id),
            name: card.title || `Video ${card.id}`,
            thumbnails: new Thumbnails([new Thumbnail(card.thumbnail, 0)]),
            author: author,
            uploadDate: parseDate(card.publishedDate),
            duration: 0,
            viewCount: -1,
            url: `${PLATFORM_BASE_URL}/watch?v=${card.id}`,
            isLive: false
        }));
    }

    return new VideoPager(videos, false);
};

// Source: Search Capabilities
source.getSearchCapabilities = function() {
    return {
        types: [Type.Feed.Videos],
        sorts: [],
        filters: []
    };
};

// Source: Search Suggestions
source.searchSuggestions = function(query) {
    return [];
};

// Source: Search
source.search = function(query, type, order, filters) {
    const url = `${PLATFORM_BASE_URL}/search?search=${encodeURIComponent(query)}`;
    const html = makeGetRequest(url, false);

    if (!html) {
        return new VideoPager([], false);
    }

    const videoCards = parseVideoCardsFromHtml(html);
    const videos = [];

    for (const card of videoCards) {
        // Use channel info extracted from within the video card
        const author = card.channel
            ? createAuthorLink(card.channel.id, card.channel.name, card.channel.url, card.channel.avatar)
            : createAuthorLink("unknown", "Unknown", null, "");

        videos.push(new PlatformVideo({
            id: createPlatformID(card.id),
            name: card.title || `Video ${card.id}`,
            thumbnails: new Thumbnails([new Thumbnail(card.thumbnail, 0)]),
            author: author,
            uploadDate: parseDate(card.publishedDate),
            duration: 0,
            viewCount: -1,
            url: `${PLATFORM_BASE_URL}/watch?v=${card.id}`,
            isLive: false
        }));
    }

    return new VideoPager(videos, false);
};

// Source: Is Content Details URL (accepts PreserveTube and YouTube video URLs)
source.isContentDetailsUrl = function(url) {
    return REGEX_VIDEO_URL.test(url) || isYouTubeVideoUrl(url);
};

// Source: Get Content Details
source.getContentDetails = function(url) {
    const videoId = extractVideoId(url);

    if (!videoId) {
        throw new ScriptException("Invalid video URL: " + url);
    }

    // Use the JSON API for video details
    const apiUrl = `${PLATFORM_BASE_URL}/video/${videoId}`;
    const videoData = makeGetRequest(apiUrl, true, true);

    // Check if video is not archived (404)
    if (videoData && videoData.error) {
        if (videoData.code === 404) {
            // Video not archived - throw captcha exception to allow archiving
            const saveUrl = buildSaveUrl(videoId);
            log(`Video ${videoId} not archived. Redirecting to save page: ${saveUrl}`);
            throw new CaptchaRequiredException(saveUrl,
                `<html><body>
                <h1>Video Not Archived</h1>
                <p>This video is not yet archived on PreserveTube.</p>
                <p>Solve the captcha to request archiving. After completion, try playing the video again.</p>
                <script>window.location.href = "${saveUrl}";</script>
                </body></html>`
            );
        }
        throw new ScriptException("Failed to fetch video details for: " + videoId);
    }

    if (!videoData) {
        throw new ScriptException("Failed to fetch video details for: " + videoId);
    }

    // Check if video is disabled
    if (videoData.disabled) {
        throw new UnavailableException("This video has been disabled");
    }

    const author = createAuthorLink(
        videoData.channelId || "unknown",
        videoData.channel || "Unknown",
        videoData.channelId ? `${PLATFORM_BASE_URL}/channel/${videoData.channelId}` : null,
        videoData.channelAvatar || ""
    );

    return new PlatformVideoDetails({
        id: createPlatformID(videoData.id),
        name: videoData.title || `Video ${videoData.id}`,
        thumbnails: new Thumbnails([new Thumbnail(videoData.thumbnail || "", 0)]),
        author: author,
        uploadDate: parseDate(videoData.published),
        duration: 0,
        viewCount: -1,
        url: `${PLATFORM_BASE_URL}/watch?v=${videoData.id}`,
        isLive: false,
        description: videoData.description || "",
        video: getVideoSource(videoData)
    });
};

// Source: Is Channel URL (accepts PreserveTube and YouTube channel URLs)
source.isChannelUrl = function(url) {
    return REGEX_CHANNEL_URL.test(url) || isYouTubeChannelUrl(url);
};

// Source: Get Channel
source.getChannel = function(url) {
    const channelId = extractChannelId(url);

    if (!channelId) {
        throw new ScriptException("Invalid channel URL: " + url);
    }

    // Check cache
    if (state.channelCache[channelId]) {
        return state.channelCache[channelId];
    }

    // Fetch channel page to get metadata
    const channelUrl = `${PLATFORM_BASE_URL}/channel/${channelId}`;
    const html = makeGetRequest(channelUrl, false);

    if (!html) {
        throw new ScriptException("Failed to fetch channel: " + channelId);
    }

    // Parse channel info from HTML
    // Look for channel name in h1 or similar
    let channelName = channelId;
    const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (nameMatch) {
        channelName = nameMatch[1].trim();
    }

    // Look for channel avatar
    let avatar = "";
    const avatarMatch = html.match(/<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]*)"[^>]*>/i);
    if (avatarMatch) {
        avatar = avatarMatch[1];
    } else {
        // Try finding any circular image near the channel name
        const altAvatarMatch = html.match(/<img[^>]*style="[^"]*border-radius[^"]*"[^>]*src="([^"]*)"[^>]*>/i);
        if (altAvatarMatch) {
            avatar = altAvatarMatch[1];
        }
    }

    // Check if verified
    const isVerified = html.includes('verified') || html.includes('checkmark');

    // Build URL alternatives including YouTube channel URL
    const youtubeChannelUrl = buildYouTubeChannelUrl(channelId);
    const urlAlternatives = youtubeChannelUrl ? [youtubeChannelUrl] : [];

    const channel = new PlatformChannel({
        id: createPlatformID(channelId),
        name: channelName,
        thumbnail: avatar,
        banner: "",
        subscribers: -1,
        description: `Archived videos from ${channelName} on PreserveTube`,
        url: channelUrl,
        urlAlternatives: urlAlternatives,
        links: {}
    });

    // Cache the channel
    state.channelCache[channelId] = channel;

    return channel;
};

// Source: Get Channel Capabilities
source.getChannelCapabilities = function() {
    return {
        types: [Type.Feed.Videos],
        sorts: [],
        filters: []
    };
};

// Source: Get Channel Contents
source.getChannelContents = function(url, type, order, filters) {
    const channelId = extractChannelId(url);

    if (!channelId) {
        return new VideoPager([], false);
    }

    // Try the /videos endpoint first for archived-only videos
    let channelUrl = `${PLATFORM_BASE_URL}/channel/${channelId}/videos`;
    let html = makeGetRequest(channelUrl, false);

    // If that fails, try the main channel page
    if (!html) {
        channelUrl = `${PLATFORM_BASE_URL}/channel/${channelId}`;
        html = makeGetRequest(channelUrl, false);
    }

    if (!html) {
        return new VideoPager([], false);
    }

    const videoCards = parseVideoCardsFromHtml(html);
    const videos = [];

    // Get channel info for author
    let channel;
    try {
        channel = source.getChannel(url);
    } catch (e) {
        log("Failed to get channel info: " + e.message);
    }

    const author = channel
        ? createAuthorLink(channelId, channel.name, channel.url, channel.thumbnail)
        : createAuthorLink(channelId, channelId, `${PLATFORM_BASE_URL}/channel/${channelId}`, "");

    for (const card of videoCards) {
        videos.push(new PlatformVideo({
            id: createPlatformID(card.id),
            name: card.title || `Video ${card.id}`,
            thumbnails: new Thumbnails([new Thumbnail(card.thumbnail, 0)]),
            author: author,
            uploadDate: parseDate(card.publishedDate),
            duration: 0,
            viewCount: -1,
            url: `${PLATFORM_BASE_URL}/watch?v=${card.id}`,
            isLive: false
        }));
    }

    return new VideoPager(videos, false);
};


// Helper: Create PlatformID
function createPlatformID(id) {
    return new PlatformID(PLATFORM, id, config?.id);
}

// Helper: Create PlatformAuthorLink
function createAuthorLink(channelId, channelName, channelUrl, thumbnail) {
    return new PlatformAuthorLink(
        createPlatformID(channelId),
        channelName || "Unknown",
        channelUrl || `${PLATFORM_BASE_URL}/channel/${channelId}`,
        thumbnail || ""
    );
}

// Helper: Parse date string to Unix timestamp
function parseDate(dateStr) {
    if (!dateStr) return Math.floor(Date.now() / 1000);
    try {
        // Handle formats like "December 17, 2023" or ISO dates
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            return Math.floor(Date.now() / 1000);
        }
        return Math.floor(date.getTime() / 1000);
    } catch (e) {
        return Math.floor(Date.now() / 1000);
    }
}

// Helper: Extract video ID from URL (supports PreserveTube and YouTube URLs)
function extractVideoId(url) {
    // Try PreserveTube URL first
    let match = url.match(REGEX_VIDEO_URL);
    if (match) return match[1];

    // Try all YouTube URL patterns
    match = url.match(REGEX_YOUTUBE_VIDEO_WATCH);
    if (match) return match[1];

    match = url.match(REGEX_YOUTUBE_VIDEO_SHARE);
    if (match) return match[1];

    match = url.match(REGEX_YOUTUBE_VIDEO_EMBED);
    if (match) return match[1];

    match = url.match(REGEX_YOUTUBE_VIDEO_V);
    if (match) return match[1];

    match = url.match(REGEX_YOUTUBE_VIDEO_SHORTS);
    if (match) return match[1];

    return null;
}

// Helper: Check if URL is a YouTube video URL
function isYouTubeVideoUrl(url) {
    return REGEX_YOUTUBE_VIDEO_WATCH.test(url) ||
           REGEX_YOUTUBE_VIDEO_SHARE.test(url) ||
           REGEX_YOUTUBE_VIDEO_EMBED.test(url) ||
           REGEX_YOUTUBE_VIDEO_V.test(url) ||
           REGEX_YOUTUBE_VIDEO_SHORTS.test(url);
}

// Helper: Extract channel ID from URL (supports PreserveTube and YouTube URLs)
function extractChannelId(url) {
    // Try PreserveTube URL first
    let match = url.match(REGEX_CHANNEL_URL);
    if (match) return match[1];

    // Try YouTube channel ID (UCxxx)
    match = url.match(REGEX_YOUTUBE_CHANNEL_ID);
    if (match) return match[1];

    // Try YouTube handle (@name)
    match = url.match(REGEX_YOUTUBE_CHANNEL_HANDLE);
    if (match) return "@" + match[1];

    // Try YouTube custom URL (/c/name)
    match = url.match(REGEX_YOUTUBE_CHANNEL_CUSTOM);
    if (match) return match[1];

    // Try YouTube user URL (/user/name)
    match = url.match(REGEX_YOUTUBE_CHANNEL_USER);
    if (match) return match[1];

    return null;
}

// Helper: Check if URL is a YouTube channel URL
function isYouTubeChannelUrl(url) {
    return REGEX_YOUTUBE_CHANNEL_ID.test(url) ||
           REGEX_YOUTUBE_CHANNEL_HANDLE.test(url) ||
           REGEX_YOUTUBE_CHANNEL_CUSTOM.test(url) ||
           REGEX_YOUTUBE_CHANNEL_USER.test(url);
}

// Helper: Make HTTP GET request
function makeGetRequest(url, parseJson = true, returnError = false) {
    try {
        const resp = http.GET(url, {});
        if (!resp.isOk) {
            log(`Request failed with status ${resp.code}: ${url}`);
            if (returnError) {
                return { error: true, code: resp.code, body: resp.body };
            }
            return null;
        }
        if (parseJson) {
            return JSON.parse(resp.body);
        }
        return resp.body;
    } catch (e) {
        log(`Request error: ${e.message}`);
        return null;
    }
}

// Helper: Build YouTube URL from video ID
function buildYouTubeUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

// Helper: Build PreserveTube save URL for archiving
function buildSaveUrl(videoId) {
    const youtubeUrl = buildYouTubeUrl(videoId);
    return `${PLATFORM_BASE_URL}/save?url=${encodeURIComponent(youtubeUrl)}`;
}

// Helper: Build YouTube channel URL from channel ID
function buildYouTubeChannelUrl(channelId) {
    if (!channelId) return null;

    // Channel ID format (UCxxxxxxx - 24 chars starting with UC)
    if (channelId.startsWith("UC") && channelId.length === 24) {
        return `https://www.youtube.com/channel/${channelId}`;
    }

    // Handle format (@name)
    if (channelId.startsWith("@")) {
        return `https://www.youtube.com/${channelId}`;
    }

    // For other formats (custom names), use the @handle format
    return `https://www.youtube.com/@${channelId}`;
}

// Helper: Parse video cards from HTML
// Returns array of objects with video info AND associated channel info
function parseVideoCardsFromHtml(html) {
    const videos = [];
    const seenIds = new Set();

    // Strategy: Find each video link, then look for the next channel link that follows it
    // This associates each video with its correct channel based on DOM order

    // First, find all video link positions
    const videoLinkRegex = /<a[^>]*href="\/watch\?v=([\w\-_]{11})"[^>]*>([\s\S]*?)<\/a>/gi;
    const channelLinkRegex = /<a[^>]*href="\/channel\/(@?[\w\-_]+)"[^>]*>([\s\S]*?)<\/a>/gi;

    // Collect all video matches with their positions
    const videoMatches = [];
    let match;
    while ((match = videoLinkRegex.exec(html)) !== null) {
        videoMatches.push({
            videoId: match[1],
            content: match[2],
            endIndex: match.index + match[0].length
        });
    }

    // Collect all channel matches with their positions
    const channelMatches = [];
    while ((match = channelLinkRegex.exec(html)) !== null) {
        channelMatches.push({
            channelId: match[1],
            content: match[2],
            startIndex: match.index
        });
    }

    // For each video, find the next channel link that appears after it
    for (const video of videoMatches) {
        if (seenIds.has(video.videoId)) continue;
        seenIds.add(video.videoId);

        const cardContent = video.content;

        // Extract thumbnail
        const thumbMatch = cardContent.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
        const thumbnail = thumbMatch ? thumbMatch[1] : "";

        // Extract title - look for text in div or span
        const titleMatch = cardContent.match(/<(?:div|span|p)[^>]*>([^<]{10,})<\/(?:div|span|p)>/i);
        let title = titleMatch ? titleMatch[1].trim() : "";

        if (!title) {
            const altTitleMatch = cardContent.match(/>([^<]{20,})</);
            title = altTitleMatch ? altTitleMatch[1].trim() : `Video ${video.videoId}`;
        }

        title = title.replace(/\s+/g, ' ').trim();

        // Extract dates
        const dateMatch = cardContent.match(/Published on ([^|<]+)/i);
        const publishedDate = dateMatch ? dateMatch[1].trim() : null;

        const archivedMatch = cardContent.match(/Archived on ([^<]+)/i);
        const archivedDate = archivedMatch ? archivedMatch[1].trim() : null;

        // Find the channel that appears after this video (closest one)
        let channelInfo = null;
        for (const channel of channelMatches) {
            if (channel.startIndex > video.endIndex) {
                // This channel appears after the video - extract its info
                const avatarMatch = channel.content.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
                const avatar = avatarMatch ? avatarMatch[1] : "";

                const nameMatch = channel.content.match(/>([^<]+)</);
                const name = nameMatch ? nameMatch[1].trim() : channel.channelId;

                channelInfo = {
                    id: channel.channelId,
                    name: name,
                    avatar: avatar,
                    url: `${PLATFORM_BASE_URL}/channel/${channel.channelId}`
                };
                break; // Use the first (closest) channel after this video
            }
        }

        videos.push({
            id: video.videoId,
            title: title,
            thumbnail: thumbnail,
            publishedDate: publishedDate,
            archivedDate: archivedDate,
            channel: channelInfo
        });
    }

    return videos;
}

// Helper: Get video source descriptor
function getVideoSource(videoData) {
    const sourceUrl = videoData.source || `https://s0.archive.party/preservetube/${videoData.id}.webm`;

    return new VideoSourceDescriptor([
        new VideoUrlSource({
            name: "WebM",
            container: "video/webm",
            url: sourceUrl,
            width: 0,
            height: 0,
            duration: 0,
            codec: "vp9"
        })
    ]);
}

log("PreserveTube plugin loaded");
