// @ts-nocheck
(function(trackingUrl, apiKey) {
    const DEBUG_MODE = location.hostname === 'localhost' || location.search.includes('mdb_pixel_debug=true');
    const trackingID = trackingUrl.split('/').pop();
    if (DEBUG_MODE) console.debug('Pixel script started. Initial trackingUrl:', trackingUrl, 'trackingID:', trackingID);

    // Use the passed-in trackingUrl
    if (!trackingUrl || trackingUrl.includes('TRACKING_ENDPOINT') || !trackingID) {
        if (DEBUG_MODE) console.debug('Tracking endpoint URL not provided or not replaced in script.');
        return;
    }

    if (!window.crypto || !window.crypto.randomUUID) {
        if (DEBUG_MODE) console.debug('crypto.randomUUID not available for device ID generation.');
    }
    if (!window.localStorage) {
        if (DEBUG_MODE) console.debug('localStorage not available for storing device ID.');
    }

    const PIXEL_VERSION = '4.1.4';
    const LOCAL_STORAGE_KEY = '_mdb_did';

    let isUnloading = false;

    // --- Device ID Management ---
    function generateUUID() {
        if (window.crypto && window.crypto.randomUUID) {
            return crypto.randomUUID();
        }

        if (window.crypto && window.crypto.getRandomValues) {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
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
            if (!deviceId && window.crypto && window.crypto.randomUUID) {
                deviceId = crypto.randomUUID();
            }
        }
        if (!deviceId) {
            if (DEBUG_MODE) console.debug('Failed to generate or retrieve a device ID.');
            deviceId = 'unknown-' + Date.now();
        }
        return deviceId;
    }

    // Load the pixel via proxy
    function loadPixel(apiKey) {
        if (!apiKey) {
            return;
        }
        try {
            const deviceId = getDeviceId();
            const options = { deviceId: deviceId, trackingId: trackingID };
            const encodedOptions = encodeURIComponent(JSON.stringify(options));

            // Make a direct POST request to our proxy endpoint
            fetch('https://proxyprovider-vhkdzfr2sq-uc.a.run.app', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        apiKey: apiKey,
                        options: encodedOptions
                    })
                }).then(response => response.json())
                .then(data => {
                    if (data && data.script) {
                        const newScript = document.createElement('script');
                        newScript.textContent = data.script;
                        document.head.appendChild(newScript);
                    }
                }).catch(error => {
                    if (DEBUG_MODE) console.debug('Error loading pixel via proxy:', error);
                });

            if (DEBUG_MODE) console.debug('Pixel script added to head with deviceId:', deviceId);
        } catch (e) {
            if (DEBUG_MODE) console.debug('Error loading pixel:', e);
        }
    }

    // --- Tracking Function ---
    async function trackEvent(eventSignal, details = {}) {
        if (DEBUG_MODE) console.debug('trackEvent called with signal:', eventSignal, 'Details:', details);

        if (!eventSignal) {
            if (DEBUG_MODE) console.debug('trackEvent requires an eventSignal.');
            return;
        }

        const { customProperties = {}, outlinkUrl } = details;
        const deviceId = getDeviceId();

        // --- UTM Parameter Extraction (from current page URL) ---
        const searchParams = new URLSearchParams(location.search);
        const utmSource = searchParams.get('utm_source') || undefined;
        const utmMedium = searchParams.get('utm_medium') || undefined;
        const utmCampaign = searchParams.get('utm_campaign') || undefined;
        const utmTerm = searchParams.get('utm_term') || undefined;
        const utmContent = searchParams.get('utm_content') || undefined;

        const payload = {
            deviceId: deviceId,
            pixelTimestamp: new Date().toISOString(),
            eventSignal: eventSignal,
            pageUrl: location.href,
            pageTitle: document.title,
            eventReferrerUrl: document.referrer || undefined,
            outlinkUrl: outlinkUrl,
            customProperties: Object.keys(customProperties).length > 0 ? customProperties : undefined,
            utmSource: utmSource,
            utmMedium: utmMedium,
            utmCampaign: utmCampaign,
            utmTerm: utmTerm,
            utmContent: utmContent,
            screenWidth: screen.width,
            screenHeight: screen.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            pixelVersion: PIXEL_VERSION,
        };

        if (eventSignal === 'page_blur' && isUnloading) {
            return;
        }

        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

        try {
            // Send tracking data through our proxy instead of directly to midbound
            fetch('https://proxyprovider-vhkdzfr2sq-uc.a.run.app', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    apiKey: apiKey,
                    options: JSON.stringify(payload)
                }),
                ...(DEBUG_MODE ? {} : { keepalive: true })
            }).then(response => {
                if (!response.ok) {
                    if (DEBUG_MODE) console.debug('Fetch request failed:', response.status, response.statusText, 'proxy endpoint', payload);
                }
            }).catch(e => {
                if (DEBUG_MODE) console.debug('About to send tracking request to proxy endpoint');
                if (DEBUG_MODE) console.debug('Error sending tracking data via fetch:', e);
            });
        } catch (e) {
            if (DEBUG_MODE) console.debug('Synchronous error during fetch setup:', e);
        }
    }

    // --- Event Listeners ---

    // 1. Generic Click Tracking (for elements with IDs) & Outbound Link Tracking
    document.addEventListener('click', function(event) {
        if (!(event.target instanceof Element)) {
            return;
        }

        const clickedElement = event.target;

        if (clickedElement.id) {
            trackEvent('click', {
                customProperties: {
                    elementId: clickedElement.id,
                    elementTagName: clickedElement.tagName.toLowerCase(),
                    elementText: clickedElement.textContent?.trim().substring(0, 100) || ''
                }
            });
        }

        // Check if it's an outbound link
        const link = clickedElement.closest('a');
        if (link && link.href) {
            const linkUrl = new URL(link.href, location.href);
            const currentDomain = location.hostname;

            if (linkUrl.hostname !== currentDomain) {
                trackEvent('outlink', {
                    outlinkUrl: linkUrl.href,
                    customProperties: {
                        linkText: link.textContent?.trim().substring(0, 100) || '',
                        linkTarget: link.target || undefined
                    }
                });
            }
        }
    });

    // 2. Page View Tracking
    trackEvent('pageview');

    // 3. Page Focus/Blur Tracking
    window.addEventListener('focus', function() {
        if (!isUnloading) {
            trackEvent('page_focus');
        }
    });

    window.addEventListener('blur', function() {
        if (!isUnloading) {
            trackEvent('page_blur');
        }
    });

    // 4. Page Unload Tracking
    window.addEventListener('beforeunload', function() {
        isUnloading = true;
        trackEvent('page_unload');
    });

    // 5. Scroll Depth Tracking (25%, 50%, 75%, 100%)
    let scrollDepthTracked = { 25: false, 50: false, 75: false, 100: false };

    function trackScrollDepth() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const documentHeight = Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        );
        const windowHeight = window.innerHeight;
        const scrollPercent = Math.round((scrollTop + windowHeight) / documentHeight * 100);

        for (const depth of[25, 50, 75, 100]) {
            if (scrollPercent >= depth && !scrollDepthTracked[depth]) {
                scrollDepthTracked[depth] = true;
                trackEvent('scroll_depth', {
                    customProperties: {
                        scrollDepth: depth,
                        scrollPercent: scrollPercent
                    }
                });
            }
        }
    }

    // Throttle scroll events
    let scrollTimeout;
    window.addEventListener('scroll', function() {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = setTimeout(trackScrollDepth, 100);
    });

    loadPixel(apiKey);

})("https://proxyprovider-vhkdzfr2sq-uc.a.run.app", "328a128b-de43-4266-9b4e-153283c929e3");
