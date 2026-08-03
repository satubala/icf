const PLAYLIST_URL = 'https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/refs/heads/main/ALL.m3u';
const CORS_PROXY = 'https://corsproxy.io/?';

// DOM Element Selections
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

// State Variables
let hls = null;
let channelsData = [];
let favorites = JSON.parse(localStorage.getItem('iptv_favs') || '[]');
let currentChannelIndex = -1;
let controlsTimeout;

// Dynamic Toast Component
const errorToast = document.createElement('div');
errorToast.style.cssText = 'position:absolute; top:20px; right:20px; background:rgba(239,68,68,0.9); color:#fff; padding:10px 16px; border-radius:6px; font-size:0.85rem; z-index:30; display:none; backdrop-filter:blur(4px);';
videoWrapper.appendChild(errorToast);

function showError(msg) {
    errorToast.innerText = msg;
    errorToast.style.display = 'block';
    setTimeout(() => { errorToast.style.display = 'none'; }, 4000);
}

// Fetch and Parse M3U Playlist
async function loadPlaylist() {
    showLoader(true);
    try {
        let text = '';
        try {
            const res = await fetch(PLAYLIST_URL);
            text = await res.text();
        } catch (e) {
            const res = await fetch(CORS_PROXY + encodeURIComponent(PLAYLIST_URL));
            text = await res.text();
        }

        channelsData = parseM3U(text);
        populateCategories();
        renderChannels(channelsData);

        const lastPlayedUrl = localStorage.getItem('iptv_last_channel');
        let initialIdx = channelsData.findIndex(ch => ch.url === lastPlayedUrl);
        if (initialIdx === -1 && channelsData.length > 0) initialIdx = 0;

        if (initialIdx !== -1) {
            playChannel(initialIdx);
        }
    } catch (err) {
        showError('Failed to fetch or parse playlist file.');
        console.error(err);
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
        const logoSrc = ch.logo || 'https://via.placeholder.com/40/131b2e/ffffff?text=TV';

        item.innerHTML = `
            <img class="channel-logo" src="${logoSrc}" onerror="this.src='https://via.placeholder.com/40/131b2e/ffffff?text=TV'" />
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

// Channel Playback Controller
function playChannel(index, useProxy = false) {
    if (index < 0 || index >= channelsData.length) return;
    
    currentChannelIndex = index;
    const channel = channelsData[index];
    localStorage.setItem('iptv_last_channel', channel.url);

    showLoader(true);
    document.getElementById('currentTitle').innerText = channel.name;
    const logoImg = document.getElementById('currentLogo');
    if (channel.logo) {
        logoImg.src = channel.logo;
        logoImg.style.display = 'block';
    } else {
        logoImg.style.display = 'none';
    }

    filterChannels();

    let streamUrl = channel.url;
    if (useProxy || streamUrl.startsWith('http://')) {
        streamUrl = CORS_PROXY + encodeURIComponent(channel.url);
    }

    if (hls) hls.destroy();

    if (Hls.isSupported()) {
        hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            xhrSetup: function(xhr) { xhr.withCredentials = false; }
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {});
            setupQualityLevels(hls.levels);
            showLoader(false);
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                if (!useProxy) {
                    console.warn('Direct stream blocked. Attempting proxy fallback...');
                    playChannel(index, true);
                } else {
                    showLoader(false);
                    showError('Stream failed to load (Offline or CORS restricted).');
                }
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', () => {
            video.play();
            showLoader(false);
        });
    }
}

function setupQualityLevels(levels) {
    qualitySelect.innerHTML = '<option value="-1">Auto Quality</option>';
    levels.forEach((level, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.innerText = level.height ? `${level.height}p` : `Level ${index}`;
        qualitySelect.appendChild(option);
    });
}

// User Activity Timer (Hover & Touch)
function handleUserActivity() {
    videoWrapper.classList.add('user-active');
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
        if (!video.paused) videoWrapper.classList.remove('user-active');
    }, 3000);
}

// Event Listeners
videoWrapper.addEventListener('mousemove', handleUserActivity);
videoWrapper.addEventListener('touchstart', handleUserActivity);

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
    volumeSlider.value = video.muted ? 0 : video.volume;
    muteBtn.innerHTML = video.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
};

volumeSlider.oninput = (e) => {
    video.volume = e.target.value;
    video.muted = (video.volume === 0);
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

qualitySelect.onchange = (e) => { if (hls) hls.currentLevel = parseInt(e.target.value); };
toggleSidebarBtn.onclick = () => sidebar.classList.toggle('open');
searchInput.oninput = filterChannels;
categorySelect.onchange = filterChannels;

// Keyboard Navigation
document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
        case ' ':
            e.preventDefault();
            playBtn.click();
            break;
        case 'f':
            fullscreenBtn.click();
            break;
        case 'm':
            muteBtn.click();
            break;
        case 'p':
            pipBtn.click();
            break;
        case 'arrowup':
            e.preventDefault();
            if (currentChannelIndex > 0) playChannel(currentChannelIndex - 1);
            break;
        case 'arrowdown':
            e.preventDefault();
            if (currentChannelIndex < channelsData.length - 1) playChannel(currentChannelIndex + 1);
            break;
    }
});

function showLoader(show) { loader.style.display = show ? 'block' : 'none'; }

// Initialize Player
loadPlaylist();
