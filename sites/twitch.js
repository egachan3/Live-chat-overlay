"use strict";
/**
 * sites/twitch.ts
 *
 * Twitch のチャットDOM監視を担当するモジュール。
 *
 * YouTubeと異なり、Twitchのチャットは別オリジンiframeではなく、メインページと
 * 同一ドキュメント内に存在する（実機のDevToolsで確認済み）。ページ内には広告・
 * 拡張機能用の複数のiframeが存在するが、チャットとは無関係であることも確認済み。
 * そのため、YouTube版のようなトップフレーム/iframeの分岐や、postMessageによる
 * フレーム間通信、隠しiframeによる「チャット欄を閉じても更新を止めない」回避策は
 * 一切不要で、単一コンテキストで完結する実装でよい。
 *
 * - module: "None" 構成のため import/export は使用不可。
 * - overlay.ts が読み込まれていればグローバル LiveChatOverlay を利用する。
 */
(function () {
    "use strict";
    /** チャットメッセージ一覧のコンテナのセレクタ */
    const CHAT_CONTAINER_SELECTOR = '[data-test-selector="chat-scrollable-area__message-container"]';
    /** メッセージ1件の要素のセレクタ */
    const CHAT_MESSAGE_SELECTOR = '[data-a-target="chat-line-message"]';
    /** 投稿者名の要素のセレクタ */
    const CHAT_AUTHOR_SELECTOR = '[data-a-target="chat-message-username"]';
    /** メッセージ本文の要素のセレクタ（テキストとエモート画像が混在する） */
    const CHAT_BODY_SELECTOR = '[data-a-target="chat-line-message-body"]';
    /**
     * シアターモード中の動画プレイヤーコンテナに付与されるクラス名（実機で確認済み）。
     * 通常モードでは一致する要素が存在せず、シアターモードONで出現する。
     */
    const THEATRE_MODE_SELECTOR = '[class*="channel-page__video-player--theatre-mode"]';
    /**
     * 通常時のオーバーレイのz-index。Twitchのヘッダー（nav.top-nav、z-index: 1000）
     * より低くすることで、オーバーレイがヘッダーに被らないようにする（実機で確認済み）。
     */
    const NORMAL_Z_INDEX = 900;
    /**
     * シアターモード/全画面表示中のオーバーレイのz-index。
     * Twitchのシアターモード/全画面用の動画プレイヤーコンテナ（z-index: 3000、
     * position: fixed）より高くする必要がある（実機で確認済み。この値でないと
     * オーバーレイが動画プレイヤーの後ろに隠れて一切表示されない）。
     * Twitchのトースト通知・snackbar（z-index: 4000〜5010）よりは低い値に留めている。
     * チャットコメントの視認性よりトースト通知の視認性を優先する設計判断のため。
     */
    const IMMERSIVE_Z_INDEX = 3500;
    /** 直近でLiveChatOverlay.setVideoElement()に渡した要素（重複呼び出し防止用） */
    let lastVideoEl = null;
    /** 直近確認したチャンネルのパス（location.pathname。チャンネル切り替え検知用） */
    let lastPathname = null;
    /**
     * <video>要素を探し、見つかればオーバーレイの位置決め基準として通知する。
     * オーバーレイ側は position: fixed とこの要素の getBoundingClientRect() を
     * 基に自身の座標を計算するため、動画要素の親要素（本体DOM）には触れない。
     */
    function syncVideoElement() {
        const video = document.querySelector("video");
        if (!video || video === lastVideoEl) {
            return;
        }
        if (typeof window.LiveChatOverlay?.setVideoElement === "function") {
            window.LiveChatOverlay.setVideoElement(video);
            lastVideoEl = video;
        }
    }
    /**
     * メッセージ本文要素の子ノードを走査し、テキストノードとエモート画像を
     * 出現順に連結して本文文字列を組み立てる。
     * 単純に textContent を使うと <img> のエモート表現（alt属性）が失われるため、
     * ノード種別ごとに個別に処理する。
     */
    function extractBodyText(bodyEl) {
        let text = "";
        bodyEl.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent ?? "";
            }
            else if (node instanceof HTMLImageElement) {
                text += node.alt ?? "";
            }
            else if (node instanceof Element) {
                // 想定外の要素（装飾用span等）が挟まる場合に備え、再帰的に処理する
                text += extractBodyText(node);
            }
        });
        return text;
    }
    /**
     * コメント要素から投稿者名・本文テキストを抽出する。
     * 本文要素が見つからない場合は null を返す。
     */
    function extractComment(el) {
        const authorEl = el.querySelector(CHAT_AUTHOR_SELECTOR);
        const bodyEl = el.querySelector(CHAT_BODY_SELECTOR);
        if (!bodyEl) {
            return null;
        }
        const author = authorEl?.textContent?.trim() ?? "";
        const text = extractBodyText(bodyEl).trim();
        if (text.length === 0) {
            return null;
        }
        return { author, text };
    }
    /**
     * MutationObserver が検知した追加ノードを処理する。
     *
     * 実機検証済みの重要な挙動：addedNodes に渡ってくる要素は
     * [data-a-target="chat-line-message"] に一致するメッセージ要素自身ではなく、
     * その外側のラッパーdiv（クラス名 Layout-sc-1xcs6mc-0 など）である。
     * そのため「ノード自身が一致するか」だけでなく「子孫に一致する要素があるか」も
     * チェックする必要がある。1コメントにつき1回だけラッパーdivの追加が検知される
     * ことも確認済みのため、重複除去ロジックは不要。
     */
    function handleAddedNode(node) {
        if (!(node instanceof Element)) {
            return;
        }
        const messageEls = node.matches(CHAT_MESSAGE_SELECTOR)
            ? [node]
            : Array.from(node.querySelectorAll(CHAT_MESSAGE_SELECTOR));
        for (const messageEl of messageEls) {
            const comment = extractComment(messageEl);
            if (comment && typeof window.LiveChatOverlay?.addComment === "function") {
                window.LiveChatOverlay.addComment(comment.author, comment.text);
            }
        }
    }
    /**
     * location.pathname の変化を確認し、チャンネルが切り替わっていれば
     * オーバーレイの表示中コメントをクリアする。
     * Twitchは<video>要素が使い回されたままチャンネルだけが切り替わるケースがあるため、
     * setVideoElement() 側の要素参照の同一性判定だけでは切り替わりを検知できない。
     * そのため pathname（チャンネル名を含むURLパス）の変化を判定材料として使う。
     */
    function checkChannelChange() {
        const pathname = location.pathname;
        if (lastPathname !== null && pathname !== lastPathname) {
            if (typeof window.LiveChatOverlay?.resetForNewStream === "function") {
                window.LiveChatOverlay.resetForNewStream();
            }
        }
        lastPathname = pathname;
    }
    /**
     * 全画面表示中、またはシアターモード中かどうかを判定する。
     * どちらの場合も動画プレイヤーがz-index: 3000のposition: fixedで前面に出るため、
     * オーバーレイのz-indexをそれより高くする必要がある。
     */
    function isImmersiveMode() {
        return (document.fullscreenElement !== null ||
            document.querySelector(THEATRE_MODE_SELECTOR) !== null);
    }
    /**
     * 現在の表示モード（通常/シアターモード・全画面）に応じて、オーバーレイの
     * z-indexを切り替える。呼び出しごとに毎回判定して設定するだけの単純な処理
     * （setZIndex側は値が変わらなければ実質no-opなので、頻繁に呼んでも問題ない）。
     */
    function syncZIndex() {
        if (typeof window.LiveChatOverlay?.setZIndex === "function") {
            window.LiveChatOverlay.setZIndex(isImmersiveMode() ? IMMERSIVE_Z_INDEX : NORMAL_Z_INDEX);
        }
    }
    /** チャットコンテナ要素に対する MutationObserver（見つかり次第セットアップする） */
    let chatObserver = null;
    let observedChatContainerEl = null;
    /**
     * チャットメッセージコンテナが見つかれば、そのコンテナに対するコメント監視を
     * 開始する。すでに同じ要素を監視中であれば何もしない。
     */
    function ensureChatContainerObserved() {
        const containerEl = document.querySelector(CHAT_CONTAINER_SELECTOR);
        if (!containerEl || containerEl === observedChatContainerEl) {
            return;
        }
        chatObserver?.disconnect();
        chatObserver = new MutationObserver((mutations) => {
            checkChannelChange();
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(handleAddedNode);
            }
        });
        chatObserver.observe(containerEl, { childList: true, subtree: true });
        observedChatContainerEl = containerEl;
    }
    // 初回チェック（すでにDOMに存在している場合に対応。ページロード時点で既に
    // シアターモード/全画面だったケースにも対応するため syncZIndex() もここで呼ぶ）
    syncVideoElement();
    ensureChatContainerObserved();
    syncZIndex();
    lastPathname = location.pathname;
    // SPA遷移・チャンネル切り替えに対応するため document.body を常時監視する。
    // メッセージコンテナがまだ見つかっていない場合（初回ロード直後・SPA遷移直後）は
    // ここで継続的にリトライされる（YouTube版の ensureItemsObserved と同じ二段構え）。
    // シアターモードのクラス切り替えも childList/subtree の変更として検知できることを
    // 実機で確認済みのため、ここで syncZIndex() も呼ぶ。
    const bodyObserver = new MutationObserver(() => {
        syncVideoElement();
        checkChannelChange();
        ensureChatContainerObserved();
        syncZIndex();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    // Fullscreen API使用時（fullscreenchange）はDOM構造の変更を伴わない場合があるため、
    // bodyObserverでは検知できない可能性がある。専用のイベントリスナーで確実に拾う。
    document.addEventListener("fullscreenchange", syncZIndex);
})();
