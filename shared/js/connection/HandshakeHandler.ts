import {CommandResult} from "../connection/ServerConnectionDeclaration";
import {IdentitifyType} from "../profiles/Identity";
import {AbstractServerConnection} from "../connection/ConnectionBase";
import {DisconnectReason} from "../ConnectionHandler";
import {tr} from "../i18n/localize";
import {ConnectParameters} from "tc-shared/ui/modal/connect/Controller";
import {LogCategory, logWarn} from "tc-shared/log";
import {getBackend} from "tc-shared/backend";

export interface HandshakeIdentityHandler {
    connection: AbstractServerConnection;

    executeHandshake();
    registerCallback(callback: (success: boolean, message?: string) => any);

    fillClientInitData(data: any);
}

export class HandshakeHandler {
    private connection: AbstractServerConnection;
    private handshakeImpl: HandshakeIdentityHandler;
    private handshakeFailed: boolean;

    readonly parameters: ConnectParameters;

    constructor(parameters: ConnectParameters) {
        this.parameters = parameters;
        this.handshakeFailed = false;
    }

    setConnection(con: AbstractServerConnection) {
        this.connection = con;
    }

    initialize() {
        this.handshakeImpl = this.parameters.profile.spawnIdentityHandshakeHandler(this.connection);
        if(!this.handshakeImpl) {
            this.handshake_failed("failed to create identity handler");
            return;
        }

        this.handshakeImpl.registerCallback((flag, message) => {
            if(flag) {
                this.handleHandshakeFinished().then(undefined);
            } else {
                this.handshake_failed(message);
            }
        });
    }

    get_identity_handler() : HandshakeIdentityHandler {
        return this.handshakeImpl;
    }

    startHandshake() {
        this.handshakeImpl.executeHandshake();
    }

    on_teamspeak() {
        const type = this.parameters.profile.selectedType();
        if(type == IdentitifyType.TEAMSPEAK) {
            this.handleHandshakeFinished();
        } else {

            if(this.handshakeFailed) return;

            this.handshakeFailed = true;
            this.connection.client.handleDisconnect(DisconnectReason.HANDSHAKE_TEAMSPEAK_REQUIRED);
        }
    }

    private handshake_failed(message: string) {
        if(this.handshakeFailed) return;

        this.handshakeFailed = true;
        this.connection.client.handleDisconnect(DisconnectReason.HANDSHAKE_FAILED, message);
    }

    private async handleHandshakeFinished() {
        const data = {
            client_nickname: this.parameters.nickname || "Another TeaSpeak user",
            client_platform: navigator.browserSpecs?.name + " " + navigator.platform,
            client_version: "TeaWeb " + __build.version + " (" + navigator.userAgent + ")",
            client_version_sign: undefined,

            client_default_channel: this.parameters.defaultChannel || "",
            client_default_channel_password: this.parameters.defaultChannelPassword || "",
            client_default_token: this.parameters.token,

            client_server_password: this.parameters.targetPassword,

            client_input_hardware: this.connection.client.isMicrophoneDisabled(),
            client_output_hardware: this.connection.client.hasOutputHardware(),
            client_input_muted: this.connection.client.isMicrophoneMuted(),
            client_output_muted: this.connection.client.isSpeakerMuted(),
        };

        if(__build.target === "client") {
            const versionsInfo = getBackend("native").getVersionInfo();
            data.client_version = "TeaClient " + versionsInfo.version;

            const arch_mapping = {
                "x32": "32bit",
                "x64": "64bit"
            };

            data.client_version += " " + (arch_mapping[versionsInfo.os_architecture] || versionsInfo.os_architecture);

            const os_mapping = {
                "win32": "Windows",
                "linux": "Linux"
            };
            data.client_platform = (os_mapping[versionsInfo.os_platform] || versionsInfo.os_platform);
        }

        this.handshakeImpl.fillClientInitData(data);
        this.connection.send_command("clientinit", data).catch(error => {
            if(error instanceof CommandResult) {
                if(error.id == 1028) {
                    this.connection.client.handleDisconnect(DisconnectReason.SERVER_REQUIRES_PASSWORD);
                } else if(error.id == 783 || error.id == 519) {
                    error.extra_message = isNaN(parseInt(error.extra_message)) ? "8" : error.extra_message;
                    this.connection.client.handleDisconnect(DisconnectReason.IDENTITY_TOO_LOW, error);
                } else if(error.id == 3329) {
                    this.connection.client.handleDisconnect(DisconnectReason.HANDSHAKE_BANNED, error);
                } else {
                    this.connection.client.handleDisconnect(DisconnectReason.CLIENT_KICKED, error);
                }
            } else
                this.connection.disconnect();
        });
    }
}