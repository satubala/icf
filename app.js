const PLAYLIST_URL = 'https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/refs/heads/main/ALL.m3u';

// List of public CORS proxies for fallback
const PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`
];

// DOM Elements
const video = document.getElementById('videoPlayer');
const videoWrapper = document.getElementById('videoWrapper');
const channelList = document.getElementById('channelList');
const searchInput = document.getElementById('searchInput');
const categorySelect = document.getElementById('categorySelect');
const channelCount = document.getElementById('channelCount');
const loader = document.getElementById('loader');
const playBtn = document.getElementById('playBtn');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const pipBtn = document.getElementById('pipBtn');
const qualitySelect = document.getElementById('qualitySelect');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const sidebar = document.getElementById('sidebar');

let hls = null;
let channelsData = [];
let favorites = JSON.parse(localStorage.getItem('iptv_favs') || '[]');
let currentChannelIndex = -1;

const errorToast = document.createElement('div');
errorToast.style.cssText = 'position:absolute; top:20px; right:20px; background:rgba(239,68,68,0.95); color:#fff; padding:10px 16px; border-radius:6px; font-size:0.85rem; z-index:30; display:none; backdrop-filter:blur(4px);';
videoWrapper.appendChild(errorToast);

function showError(msg) {
    errorToast.innerText = msg;
    errorToast.style.display = 'block';
    setTimeout(() => { errorToast.style.display = 'none'; }, 4000);
}

// Fetch helper with fallback proxies
async function fetchWithProxy(url) {
    try {
        const directRes = await fetch(url);
        if (directRes.ok) return await directRes.text();
    } catch (e) {
        console.warn('Direct fetch failed. Trying CORS proxies...');
    }

    for (const getProxyUrl of PROXIES) {
        try {
            const proxyRes = await fetch(getProxyUrl(url));
            if (proxyRes.ok) return await proxyRes.text();
        } catch (e) {
            continue;
        }
    }
    throw new Error('All proxies failed');
}

async function loadPlaylist() {
    showLoader(true);
    try {
        const text = await fetchWithProxy(PLAYLIST_URL);
        channelsData = parseM3U(text);
        populateCategories();
        renderChannels(channelsData);

        if (channelsData.length > 0) {
            playChannel(0);
        }
    } catch (err) {
        showError('Unable to load playlist. Check your internet connection.');
    } finally {
        showLoader(false);
    }
}

function parseM3U(m3u) {
    const lines = m3u.split('\n');
    const channels = [];
    let current = {};

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
            const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
            const groupMatch = line.match(/group-title="([^"]+)"/i);
            const commaIdx = line.lastIndexOf(',');
            const channelName = commaIdx !== -1 ? line.substring(commaIdx + 1).trim() : 'Unknown Channel';

            current = {
                id: 'ch_' + channels.length,
                name: channelName,
                logo: logoMatch ? logoMatch[1] : '',
                group: groupMatch ? groupMatch[1] : 'General'
            };
        } else if (line.length > 0 && !line.startsWith('#')) {
            current.url = line;
            if (current.url) channels.push(current);
            current = {};
        }
    }
    return channels;
}

function populateCategories() {
    const groups = [...new Set(channelsData.map(ch => ch.group))].sort();
    categorySelect.innerHTML = '<option value="ALL">All Categories</option><option value="FAV">★ Favorites</option>';
    groups.forEach(group => {
        const opt = document.createElement('option');
        opt.value = group;
        opt.innerText = group;
        categorySelect.appendChild(opt);
    });
}

function renderChannels(channels) {
    channelList.innerHTML = '';
    channelCount.innerText = `${channels.length} Channels`;

    channels.forEach((ch) => {
        const realIdx = channelsData.findIndex(c => c.url === ch.url);
        const item = document.createElement('div');
        item.className = `channel-item ${realIdx === currentChannelIndex ? 'active' : ''}`;
        const isFav = favorites.includes(ch.url);

        item.innerHTML = `
            <img class="channel-logo" src="${ch.logo}" onerror="this.src='https://via.placeholder.com/40/131b2e/ffffff?text=TV'" />
            <div class="channel-details">
                <div class="channel-name">${ch.name}</div>
                <div class="channel-group">${ch.group}</div>
            </div>
            <i class="fa-star ${isFav ? 'fa-solid fav-btn active' : 'fa-regular fav-btn'}"></i>
        `;

        item.querySelector('.fav-btn').onclick = (e) => {
            e.stopPropagation();
            toggleFavorite(ch.url);
        };

        item.onclick = () => {
            playChannel(realIdx);
            if (window.innerWidth <= 768) sidebar.classList.remove('open');
        };

        channelList.appendChild(item);
    });
}

function toggleFavorite(url) {
    favorites = favorites.includes(url) ? favorites.filter(u => u !== url) : [...favorites, url];
    localStorage.setItem('iptv_favs', JSON.stringify(favorites));
    filterChannels();
}

function filterChannels() {
    const query = searchInput.value.toLowerCase();
    const selectedGroup = categorySelect.value;

    const filtered = channelsData.filter(ch => {
        const matchesSearch = ch.name.toLowerCase().includes(query);
        let matchesCat = true;
        if (selectedGroup === 'FAV') {
            matchesCat = favorites.includes(ch.url);
        } else if (selectedGroup !== 'ALL') {
            matchesCat = ch.group === selectedGroup;
        }
        return matchesSearch && matchesCat;
    });

    renderChannels(filtered);
}

function playChannel(index, proxyIndex = -1) {
    if (index < 0 || index >= channelsData.length) return;
    
    currentChannelIndex = index;
    const channel = channelsData[index];

    showLoader(true);
    document.getElementById('currentTitle').innerText = channel.name;
    filterChannels();

    let streamUrl = channel.url;
    if (proxyIndex >= 0 && proxyIndex < PROXIES.length) {
        streamUrl = PROXIES[proxyIndex](channel.url);
    }

    if (hls) hls.destroy();

    // Mute video initially to guarantee autoplay permission
    video.muted = true;
    muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    volumeSlider.value = 0;

    if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(e => console.log('Autoplay blocked:', e));
            showLoader(false);
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                const nextProxyIndex = proxyIndex + 1;
                if (nextProxyIndex < PROXIES.length) {
                    playChannel(index, nextProxyIndex);
                } else {
                    showLoader(false);
                    showError('Stream offline or blocked by host server.');
                }
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.play().catch(() => {});
        showLoader(false);
    }
}

// Controls Logic
playBtn.onclick = () => {
    if (video.paused) {
        video.play();
        playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    } else {
        video.pause();
        playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }
};

muteBtn.onclick = () => {
    video.muted = !video.muted;
    volumeSlider.value = video.muted ? 0 : (video.volume || 1);
    muteBtn.innerHTML = video.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
};

volumeSlider.oninput = (e) => {
    video.volume = e.target.value;
    video.muted = (video.volume == 0);
    muteBtn.innerHTML = video.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
};

fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) videoWrapper.requestFullscreen();
    else document.exitFullscreen();
};

pipBtn.onclick = async () => {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
};

toggleSidebarBtn.onclick = () => sidebar.classList.toggle('open');
searchInput.oninput = filterChannels;
categorySelect.onchange = filterChannels;

function showLoader(show) { loader.style.display = show ? 'block' : 'none'; }

loadPlaylist();
