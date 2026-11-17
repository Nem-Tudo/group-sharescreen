import Foundation
import ActivityKit

/// "Fulano está ao vivo" — the Live Activity a friend's transmission puts on
/// this iPhone (the Dynamic Island and the lock screen).
///
/// Started by the server with a push (sharescreen-api/server/friendLive.ts),
/// which names this type by its *name* ("attributes-type") and fills these
/// fields by their *names* — so neither may be renamed on one side only.
/// Compiled into the app (which hands the tokens over) and into the widget
/// extension (which draws the card).
@available(iOS 16.1, *)
struct FriendLiveAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// False once the transmission ended (the card says so, then goes).
        var live: Bool
    }

    /// The transmission, as the server knows it — what ending it is keyed on.
    var broadcastKey: String
    var name: String
    /// How the room reads ("Família", "Grupo · #jogos").
    var roomTitle: String
    /// golive://watch/<room>?via=live-activity — what "Entrar" opens.
    var url: String
}
