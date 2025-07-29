// @ts-nocheck
(function () {
    const DEBUG_MODE = true || location.hostname === 'localhost' || location.search.includes('mdb_pixel_debug=true');
    const PROXY_URL = 'https://proxyprovider-vhkdzfr2sq-uc.a.run.app';

    // Verify DEBUG_MODE immediately
    if (DEBUG_MODE) {
        console.debug('Pixel script started. PROXY_URL:', PROXY_URL, 'Hostname:', location.hostname, 'Search:', location.search);
    } else {
        console.debug('Debug mode disabled. Hostname:', location.hostname, 'Search:', location.search);
    }

    const PIXEL_VERSION = '4.1.4';
    const LOCAL_STORAGE_KEY = '_mdb_did';
    let isUnloading = false;

    function generateUUID() {
        if (window.crypto && window.crypto.randomUUID) return crypto.randomUUID();
        if (window.crypto && window.crypto.getRandomValues) {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (c === 'x' ? 0 : 2);
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        }
        const timestamp = Date.now().toString(16);
        return `fa11bac0-0000-4000-8000-${timestamp.slice(-12).padStart(12, '0')}`;
    }

    function getDeviceId() {
        let deviceId = null;
        try {
            deviceId = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (!deviceId && window.crypto && window.crypto.randomUUID) {
                deviceId = crypto.randomUUID();
                localStorage.setItem(LOCAL_STORAGE_KEY, deviceId);
            }
        } catch (e) {
            if (DEBUG_MODE) console.debug('Could not access localStorage for device ID.', e);
            if (!deviceId && window.crypto && window.crypto.randomUUID) deviceId = crypto.randomUUID();
        }
        if (!deviceId) {
            if (DEBUG_MODE) console.debug('Failed to generate or retrieve a device ID.');
            deviceId = 'unknown-' + Date.now();
        }
        return deviceId;
    }

   function loadPixel() {
    try {
        const deviceId = getDeviceId();
        const payload = { deviceId };
        if (DEBUG_MODE) console.log('Sending pixel request to:', PROXY_URL + '/pixel', 'Payload:', payload);
        fetch(PROXY_URL + '/pixel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).then(response => {
            if (DEBUG_MODE) console.log('Pixel response:', response.status, response.statusText);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        }).then(text => {
            if (DEBUG_MODE) console.log('Pixel response body:', text);
            if (text && text.trim().startsWith('(function()')) {
                const script = document.createElement('script');
                script.textContent = text;
                document.head.appendChild(script);
                if (DEBUG_MODE) console.log('Pixel script injected.');
            } else {
                if (DEBUG_MODE) console.log('Unexpected response format:', text);
            }
        }).catch(e => {
            if (DEBUG_MODE) console.log('Error loading pixel via proxy:', e);
        });
    } catch (e) {
        if (DEBUG_MODE) console.log('Synchronous error during pixel fetch setup:', e);
    }
}

    function trackEvent(eventSignal, details = {}) {
        if (DEBUG_MODE) console.debug('trackEvent called with signal:', eventSignal, 'Details:', details);
        if (!eventSignal) {
            if (DEBUG_MODE) console.debug('trackEvent requires an eventSignal.');
            return;
        }

        const { customProperties = {}, outlinkUrl } = details;
        const deviceId = getDeviceId();
        const searchParams = new URLSearchParams(location.search);
        const payload = {
            deviceId, pixelTimestamp: new Date().toISOString(), eventSignal, pageUrl: location.href,
            pageTitle: document.title, eventReferrerUrl: document.referrer || undefined, outlinkUrl,
            customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined,
            utmSource: searchParams.get('utm_source') || undefined, utmMedium: searchParams.get('utm_medium') || undefined,
            utmCampaign: searchParams.get('utm_campaign') || undefined, utmTerm: searchParams.get('utm_term') || undefined,
            utmContent: searchParams.get('utm_content') || undefined, screenWidth: screen.width,
            screenHeight: screen.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
            pixelVersion: PIXEL_VERSION,
        };

        if (eventSignal === 'page_blur' && isUnloading) return;

        try {
            if (DEBUG_MODE) console.debug('Sending track request to:', PROXY_URL + '/track', 'Payload:', payload);
            fetch(PROXY_URL + '/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                ...(DEBUG_MODE ? {} : { keepalive: true })
            }).then(response => {
                if (!response.ok) {
                    if (DEBUG_MODE) console.debug('Track request failed:', response.status, response.statusText, payload);
                }
            }).catch(e => {
                if (DEBUG_MODE) console.debug('Error sending track data:', e);
            });
        } catch (e) {
            if (DEBUG_MODE) console.debug('Synchronous error during track fetch setup:', e);
        }
    }

    document.addEventListener('click', function (event) {
        if (!(event.target instanceof Element)) return;
        const clickedElement = event.target;
        if (clickedElement.id) {
            trackEvent('click', { customProperties: {
                elementId: clickedElement.id, elementTagName: clickedElement.tagName.toLowerCase(),
                elementText: clickedElement.textContent?.trim().substring(0, 100) || ''
            }});
        }
        const link = clickedElement.closest('a');
        if (link && link.href) {
            const linkUrl = new URL(link.href, location.href);
            if (linkUrl.hostname !== location.hostname) {
                trackEvent('outlink', { outlinkUrl: linkUrl.href, customProperties: {
                    linkText: link.textContent?.trim().substring(0, 100) || '',
                    linkTarget: link.target || undefined
                }});
            }
        }
    });

    trackEvent('pageview');

    window.addEventListener('focus', () => !isUnloading && trackEvent('page_focus'));
    window.addEventListener('blur', () => !isUnloading && trackEvent('page_blur'));
    window.addEventListener('beforeunload', () => { isUnloading = true; trackEvent('page_unload'); });

    let scrollDepthTracked = { 25: false, 50: false, 75: false, 100: false };
    function trackScrollDepth() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const documentHeight = Math.max(
            document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight,
            document.documentElement.scrollHeight, document.documentElement.offsetHeight
        );
        const windowHeight = window.innerHeight;
        const scrollPercent = Math.round((scrollTop + windowHeight) / documentHeight * 100);
        for (const depth of [25, 50, 75, 100]) {
            if (scrollPercent >= depth && !scrollDepthTracked[depth]) {
                scrollDepthTracked[depth] = true;
                trackEvent('scroll_depth', { customProperties: { scrollDepth: depth, scrollPercent } });
            }
        }
    }

    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(trackScrollDepth, 100);
    });

    loadPixel();
})();
