"use strict";
/**
 * popup.ts
 *
 * 拡張機能ポップアップ（popup.html）の設定UI用スクリプト。
 *
 * - popup.html から独立したスクリプトとして読み込まれるため、
 *   overlay.ts / sites/youtube.ts とグローバルスコープを共有しない
 *   （module: "None" 構成だが、他ファイルとは別のドキュメントコンテキスト）。
 * - overlay.ts が読み書きしているのと同じ chrome.storage.local のキー・型を使う。
 *   設定変更は overlay.ts 側の chrome.storage.onChanged 監視により
 *   コンテンツスクリプト側へリアルタイムに反映されるため、ここでは
 *   chrome.storage.local.set(...) するだけでよい。
 */
(function () {
    "use strict";
    /** chrome.storage.local に保存する設定のキー（overlay.tsと同じ名前を使う） */
    const STORAGE_KEY_ENABLED = "enabled";
    const STORAGE_KEY_FONT_SIZE = "fontSize";
    const STORAGE_KEY_OPACITY = "opacity";
    const STORAGE_KEY_DISPLAY_MODE = "displayMode";
    const STORAGE_KEY_STACK_POSITION = "stackPosition";
    /** 文字サイズの範囲・デフォルト値（overlay.tsと同じ値を使う） */
    const DEFAULT_ENABLED = true;
    const DEFAULT_FONT_SIZE = 22;
    const MIN_FONT_SIZE = 12;
    const MAX_FONT_SIZE = 32;
    /**
     * コメントの不透明度（UI表示用のパーセント整数値）の範囲・デフォルト値。
     * chrome.storage.local には overlay.ts と型を合わせるため0〜1の小数
     * （percent / 100）に変換して保存する。
     */
    const DEFAULT_OPACITY_PERCENT = 60;
    const MIN_OPACITY_PERCENT = 10;
    const MAX_OPACITY_PERCENT = 100;
    const DEFAULT_DISPLAY_MODE = "stack";
    const DEFAULT_STACK_POSITION = "left";
    /**
     * 表示スタイルの値を検証し、不正な値であればデフォルトにフォールバックする。
     */
    function normalizeDisplayMode(value) {
        return value === "flow" || value === "stack" ? value : DEFAULT_DISPLAY_MODE;
    }
    /**
     * 積み上げ型の表示位置の値を検証し、不正な値であればデフォルトにフォールバックする。
     */
    function normalizeStackPosition(value) {
        return value === "left" || value === "right" ? value : DEFAULT_STACK_POSITION;
    }
    /**
     * 文字サイズを有効範囲内にクランプする。
     */
    function clampFontSize(fontSize) {
        if (Number.isNaN(fontSize)) {
            return DEFAULT_FONT_SIZE;
        }
        return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize));
    }
    /**
     * コメントの不透明度（パーセント整数値）を有効範囲内にクランプする。
     */
    function clampOpacityPercent(opacityPercent) {
        if (Number.isNaN(opacityPercent)) {
            return DEFAULT_OPACITY_PERCENT;
        }
        return Math.min(MAX_OPACITY_PERCENT, Math.max(MIN_OPACITY_PERCENT, opacityPercent));
    }
    function init() {
        const enabledToggle = document.getElementById("enabledToggle");
        const fontSizeRange = document.getElementById("fontSizeRange");
        const fontSizeValue = document.getElementById("fontSizeValue");
        const opacityRange = document.getElementById("opacityRange");
        const opacityValue = document.getElementById("opacityValue");
        const displayModeStack = document.getElementById("displayModeStack");
        const displayModeFlow = document.getElementById("displayModeFlow");
        const stackPositionSection = document.getElementById("stackPositionSection");
        const stackPositionRight = document.getElementById("stackPositionRight");
        const stackPositionLeft = document.getElementById("stackPositionLeft");
        if (!enabledToggle ||
            !fontSizeRange ||
            !fontSizeValue ||
            !opacityRange ||
            !opacityValue ||
            !displayModeStack ||
            !displayModeFlow ||
            !stackPositionSection ||
            !stackPositionRight ||
            !stackPositionLeft) {
            return;
        }
        // 流れる型選択中は「表示位置」項目をグレーアウトし、積み上げ型専用の設定であることを示す
        const updateStackPositionAvailability = () => {
            stackPositionSection.classList.toggle("stack-position-disabled", !displayModeStack.checked);
        };
        // 現在の設定値を読み込み、UIに反映する
        chrome.storage.local.get([
            STORAGE_KEY_ENABLED,
            STORAGE_KEY_FONT_SIZE,
            STORAGE_KEY_OPACITY,
            STORAGE_KEY_DISPLAY_MODE,
            STORAGE_KEY_STACK_POSITION,
        ], (items) => {
            const enabled = typeof items[STORAGE_KEY_ENABLED] === "boolean"
                ? items[STORAGE_KEY_ENABLED]
                : DEFAULT_ENABLED;
            const fontSize = clampFontSize(typeof items[STORAGE_KEY_FONT_SIZE] === "number"
                ? items[STORAGE_KEY_FONT_SIZE]
                : DEFAULT_FONT_SIZE);
            // storageには0〜1の小数で保存されているため、UI表示用に0〜100のパーセント
            // 整数値へ変換する（overlay.ts側とのストレージ形式の一致を保つため）。
            const opacityPercent = clampOpacityPercent(typeof items[STORAGE_KEY_OPACITY] === "number"
                ? Math.round(items[STORAGE_KEY_OPACITY] * 100)
                : DEFAULT_OPACITY_PERCENT);
            const displayMode = normalizeDisplayMode(items[STORAGE_KEY_DISPLAY_MODE]);
            const stackPosition = normalizeStackPosition(items[STORAGE_KEY_STACK_POSITION]);
            enabledToggle.checked = enabled;
            fontSizeRange.value = String(fontSize);
            fontSizeValue.textContent = `${fontSize}px`;
            opacityRange.value = String(opacityPercent);
            opacityValue.textContent = `${opacityPercent}%`;
            displayModeStack.checked = displayMode === "stack";
            displayModeFlow.checked = displayMode === "flow";
            stackPositionRight.checked = stackPosition === "right";
            stackPositionLeft.checked = stackPosition === "left";
            updateStackPositionAvailability();
        });
        // ON/OFFトグル操作を保存する
        enabledToggle.addEventListener("change", () => {
            chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: enabledToggle.checked });
        });
        // 文字サイズスライダー操作を保存する
        fontSizeRange.addEventListener("input", () => {
            const fontSize = clampFontSize(Number(fontSizeRange.value));
            fontSizeValue.textContent = `${fontSize}px`;
            chrome.storage.local.set({ [STORAGE_KEY_FONT_SIZE]: fontSize });
        });
        // 不透明度スライダー操作を保存する
        // UI上はパーセント整数値だが、overlay.ts側と型を合わせるため
        // storageには0〜1の小数（percent / 100）に変換して保存する。
        // 除算結果に浮動小数点演算の丸め誤差が乗る可能性があるため、
        // 小数第2位で丸めてから保存する（toFixed→Numberで余分な桁を確実に除く）。
        opacityRange.addEventListener("input", () => {
            const opacityPercent = clampOpacityPercent(Number(opacityRange.value));
            opacityValue.textContent = `${opacityPercent}%`;
            chrome.storage.local.set({
                [STORAGE_KEY_OPACITY]: Number((opacityPercent / 100).toFixed(2)),
            });
        });
        // 表示スタイルのラジオボタン操作を保存する
        const handleDisplayModeChange = () => {
            const displayMode = displayModeFlow.checked ? "flow" : "stack";
            chrome.storage.local.set({ [STORAGE_KEY_DISPLAY_MODE]: displayMode });
            updateStackPositionAvailability();
        };
        displayModeStack.addEventListener("change", handleDisplayModeChange);
        displayModeFlow.addEventListener("change", handleDisplayModeChange);
        // 表示位置（積み上げ型：右/左）のラジオボタン操作を保存する
        const handleStackPositionChange = () => {
            const stackPosition = stackPositionLeft.checked ? "left" : "right";
            chrome.storage.local.set({ [STORAGE_KEY_STACK_POSITION]: stackPosition });
        };
        stackPositionRight.addEventListener("change", handleStackPositionChange);
        stackPositionLeft.addEventListener("change", handleStackPositionChange);
    }
    init();
})();
