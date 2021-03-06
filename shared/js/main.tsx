import * as loader from "tc-loader";
import * as bipc from "./ipc/BrowserIPC";
import * as sound from "./sound/Sounds";
import * as i18n from "./i18n/localize";
import * as fidentity from "./profiles/identities/TeaForumIdentity";
import * as aplayer from "tc-backend/audio/player";
import * as ppt from "tc-backend/ppt";
import * as global_ev_handler from "./events/ClientGlobalControlHandler";
import {Stage} from "tc-loader";
import {AppParameters, settings, Settings} from "tc-shared/settings";
import {LogCategory, logError, logInfo} from "tc-shared/log";
import {tra} from "./i18n/localize";
import {ConnectionHandler} from "tc-shared/ConnectionHandler";
import {createInfoModal} from "tc-shared/ui/elements/Modal";
import {defaultRecorder, RecorderProfile, setDefaultRecorder} from "tc-shared/voice/RecorderProfile";
import {spawnYesNo} from "tc-shared/ui/modal/ModalYesNo";
import {formatMessage} from "tc-shared/ui/frames/chat";
import {openModalNewcomer} from "tc-shared/ui/modal/ModalNewcomer";
import {global_client_actions} from "tc-shared/events/GlobalEvents";
import {MenuEntryType, spawn_context_menu} from "tc-shared/ui/elements/ContextMenu";
import {copyToClipboard} from "tc-shared/utils/helpers";
import {checkForUpdatedApp} from "tc-shared/update";
import {setupJSRender} from "tc-shared/ui/jsrender";
import {ConnectRequestData} from "tc-shared/ipc/ConnectHandler";
import {defaultConnectProfile, findConnectProfile} from "tc-shared/profiles/ConnectionProfile";
import {server_connections} from "tc-shared/ConnectionManager";
import {spawnConnectModalNew} from "tc-shared/ui/modal/connect/Controller";

/* required import for init */
import "svg-sprites/client-icons";
import "../css/load-css"
import "./proto";
import "./video-viewer/Controller";
import "./profiles/ConnectionProfile";
import "./update/UpdaterWeb";
import "./file/LocalIcons";
import "./connection/CommandHandler";
import "./connection/ConnectionBase";
import "./connection/rtc/Connection";
import "./connection/rtc/video/Connection";
import "./video/VideoSource";
import "./media/Video";
import "./ui/AppController";
import "./ui/frames/menu-bar/MainMenu";
import "./ui/modal/connect/Controller";
import "./ui/elements/ContextDivider";
import "./ui/elements/Tab";
import "./clientservice";
import {initializeKeyControl} from "./KeyControl";

let preventWelcomeUI = false;
async function initialize() {
    try {
        await i18n.initialize();
    } catch(error) {
        console.error(tr("Failed to initialized the translation system!\nError: %o"), error);
        loader.critical_error("Failed to setup the translation system");
        return;
    }

    bipc.setup();
}

async function initializeApp() {
    global_ev_handler.initialize(global_client_actions);

    if(!aplayer.initialize()) {
        console.warn(tr("Failed to initialize audio controller!"));
    }

    aplayer.on_ready(() => aplayer.set_master_volume(settings.getValue(Settings.KEY_SOUND_MASTER) / 100));

    setDefaultRecorder(new RecorderProfile("default"));
    defaultRecorder.initialize().catch(error => {
        logError(LogCategory.AUDIO, tr("Failed to initialize default recorder: %o"), error);
    });

    sound.initialize().then(() => {
        logInfo(LogCategory.AUDIO, tr("Sounds initialized"));
    });
    sound.set_master_volume(settings.getValue(Settings.KEY_SOUND_MASTER_SOUNDS) / 100);

    try {
        await ppt.initialize();
    } catch(error) {
        logError(LogCategory.GENERAL, tr("Failed to initialize ppt!\nError: %o"), error);
        loader.critical_error(tr("Failed to initialize ppt!"));
        return;
    }
}

/* Used by the native client... We can't refactor this yet */
export function handle_connect_request(properties: ConnectRequestData, connection: ConnectionHandler) {
    const profile = findConnectProfile(properties.profile) || defaultConnectProfile();
    const username = properties.username || profile.connectUsername();

    const password = properties.password ? properties.password.value : "";
    const password_hashed = properties.password ? properties.password.hashed : false;

    if(profile && profile.valid()) {
        settings.setValue(Settings.KEY_USER_IS_NEW, false);

        if(!aplayer.initialized()) {
            /* Trick the client into clicking somewhere on the site */
            spawnYesNo(tra("Connect to {}", properties.address), tra("Would you like to connect to {}?", properties.address), result => {
                if(result) {
                    aplayer.on_ready(() => handle_connect_request(properties, connection));
                } else {
                    /* Well... the client don't want to... */
                }
            }).open();
            return;
        }

        connection.startConnection(properties.address, profile, true, {
            nickname: username,
            password: password.length > 0 ? {
                password: password,
                hashed: password_hashed
            } : undefined
        });
        server_connections.setActiveConnectionHandler(connection);
    } else {
        spawnConnectModalNew({
            selectedAddress: properties.address,
            selectedProfile: profile
        });
    }
}

function main() {
    /* initialize font */
    {
        const font = settings.getValue(Settings.KEY_FONT_SIZE);

        document.body.style.fontSize = font + "px";
        settings.globalChangeListener(Settings.KEY_FONT_SIZE, value => {
            document.body.style.fontSize = value + "px";
        });
    }

    /* context menu prevent */
    document.addEventListener("contextmenu", event => {
        if(event.defaultPrevented) {
            return;
        }

        if(event.target instanceof HTMLInputElement) {
            const target = event.target;
            if((!!event.target.value || __build.target === "client") && !event.target.disabled && !event.target.readOnly && event.target.type !== "number") {
                spawn_context_menu(event.pageX, event.pageY, {
                    type: MenuEntryType.ENTRY,
                    name: tr("Copy"),
                    callback: () => copyToClipboard(target.value),
                    icon_class: "client-copy",
                    visible: !!event.target.value
                }, {
                    type: MenuEntryType.ENTRY,
                    name: tr("Paste"),
                    callback: () => {
                        const { clipboard } = __non_webpack_require__('electron');
                        target.value = clipboard.readText();
                    },
                    icon_class: "client-copy",
                    visible: __build.target === "client",
                });
            }

            event.preventDefault();
            return;
        }

        if(settings.getValue(Settings.KEY_DISABLE_GLOBAL_CONTEXT_MENU)) {
            event.preventDefault();
        }
    });
    window.removeLoaderContextMenuHook();

    const initialHandler = server_connections.spawnConnectionHandler();
    server_connections.setActiveConnectionHandler(initialHandler);
    initialHandler.acquireInputHardware().then(() => {});

    /** Setup the XF forum identity **/
    fidentity.update_forum();
    initializeKeyControl();

    checkForUpdatedApp();

    if(settings.getValue(Settings.KEY_USER_IS_NEW) && !preventWelcomeUI) {
        const modal = openModalNewcomer();
        modal.close_listener.push(() => settings.setValue(Settings.KEY_USER_IS_NEW, false));
    }
}

const task_teaweb_starter: loader.Task = {
    name: "voice app starter",
    function: async () => {
        try {
            await initializeApp();
            main();
            if(!aplayer.initialized()) {
                logInfo(LogCategory.VOICE, tr("Initialize audio controller later!"));
                if(!aplayer.initializeFromGesture) {
                    console.error(tr("Missing aplayer.initializeFromGesture"));
                } else {
                    $(document).one('click', () => aplayer.initializeFromGesture());
                }
            }

            loader.config.abortAnimationOnFinish = settings.getValue(Settings.KEY_LOADER_ANIMATION_ABORT);
        } catch (ex) {
            console.error(ex.stack);
            if(ex instanceof ReferenceError || ex instanceof TypeError) {
                ex = ex.name + ": " + ex.message;
            }
            loader.critical_error("Failed to invoke main function:<br>" + ex);
        }
    },
    priority: 10
};

const task_connect_handler: loader.Task = {
    name: "Connect handler",
    function: async () => {
        const address = AppParameters.getValue(AppParameters.KEY_CONNECT_ADDRESS, undefined);
        if(typeof address === "undefined") {
            loader.register_task(loader.Stage.LOADED, task_teaweb_starter);
            return;
        }

        /* FIXME: All additional parameters! */
        const connectData = {
            address: address,

            profile: AppParameters.getValue(AppParameters.KEY_CONNECT_PROFILE, ""),
            username: AppParameters.getValue(AppParameters.KEY_CONNECT_NICKNAME, ""),

            password: {
                value: AppParameters.getValue(AppParameters.KEY_CONNECT_SERVER_PASSWORD, ""),
                hashed: true
            }
        };

        const chandler = bipc.getInstanceConnectHandler();
        if(chandler && AppParameters.getValue(AppParameters.KEY_CONNECT_NO_SINGLE_INSTANCE)) {
            try {
                await chandler.post_connect_request(connectData, () => new Promise<boolean>(resolve => {
                    spawnYesNo(tr("Another TeaWeb instance is already running"), tra("Another TeaWeb instance is already running.{:br:}Would you like to connect there?"), response => {
                        resolve(response);
                    }, {
                        closeable: false
                    }).open();
                }));
                logInfo(LogCategory.CLIENT, tr("Executed connect successfully in another browser window. Closing this window"));

                const message =
                    "You're connecting to {0} within the other TeaWeb instance.{:br:}" +
                    "You could now close this page.";
                createInfoModal(
                    tr("Connecting successfully within other instance"),
                    formatMessage(/* @tr-ignore */ tr(message), connectData.address),
                    {
                        closeable: false,
                        footer: undefined
                    }
                ).open();
                return;
            } catch(error) {
                logInfo(LogCategory.CLIENT, tr("Failed to execute connect within other TeaWeb instance. Using this one. Error: %o"), error);
            }

            if(chandler) {
                /* no instance avail, so lets make us avail */
                chandler.callback_available = () => {
                    return !settings.getValue(Settings.KEY_DISABLE_MULTI_SESSION);
                };

                chandler.callback_execute = data => {
                    preventWelcomeUI = true;
                    handle_connect_request(data, server_connections.spawnConnectionHandler());
                    return true;
                }
            }
        }

        preventWelcomeUI = true;
        loader.register_task(loader.Stage.LOADED, {
            priority: 0,
            function: async () => handle_connect_request(connectData, server_connections.getActiveConnectionHandler() || server_connections.spawnConnectionHandler()),
            name: tr("default url connect")
        });
        loader.register_task(loader.Stage.LOADED, task_teaweb_starter);
    },
    priority: 10
};

loader.register_task(loader.Stage.JAVASCRIPT_INITIALIZING, {
    name: "jrendere initialize",
    function: async () => {
        try {
            if(!setupJSRender())
                throw "invalid load";
        } catch (error) {
            loader.critical_error(tr("Failed to setup jsrender"));
            console.error(tr("Failed to load jsrender! %o"), error);
            return;
        }
    },
    priority: 110
});

loader.register_task(loader.Stage.JAVASCRIPT_INITIALIZING, {
    name: "app starter",
    function: async () => {
        try {
            await initialize();

            if(__build.target == "web") {
                loader.register_task(loader.Stage.LOADED, task_connect_handler);
            } else {
                loader.register_task(loader.Stage.LOADED, task_teaweb_starter);
            }
        } catch (ex) {
            if(ex instanceof Error || typeof(ex.stack) !== "undefined") {
                console.error((tr || (msg => msg))("Critical error stack trace: %o"), ex.stack);
            }

            if(ex instanceof ReferenceError || ex instanceof TypeError) {
                ex = ex.name + ": " + ex.message;
            }

            loader.critical_error("Failed to boot app function:<br>" + ex);
        }
    },
    priority: 1000
});

loader.register_task(loader.Stage.LOADED, {
    name: "error task",
    function: async () => {
        if(AppParameters.getValue(AppParameters.KEY_LOAD_DUMMY_ERROR)) {
            loader.critical_error("The tea is cold!", "Argh, this is evil! Cold tea does not taste good.");
            throw "The tea is cold!";
        }
    },
    priority: 2000
});

/* TODO: Remove this after the image preview has been rewritten into react */
loader.register_task(Stage.JAVASCRIPT_INITIALIZING,{
    name: "app init",
    function: async () => {
        try {
            $("body").append($("#tmpl_main").renderTag());
        } catch(error) {
            logError(LogCategory.GENERAL, error);
            loader.critical_error(tr("Failed to setup main page!"));
            return;
        }
    },
    priority: 100
});