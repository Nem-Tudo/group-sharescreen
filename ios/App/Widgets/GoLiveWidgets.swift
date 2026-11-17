import WidgetKit
import SwiftUI
import ActivityKit

// The app's widget extension. For now it only draws Live Activities: the
// "fulano está ao vivo" card (App/FriendLiveAttributes.swift), started by the
// server's push — see sharescreen-api/server/friendLive.ts.

@main
struct GoLiveWidgets: WidgetBundle {
    var body: some Widget {
        FriendLiveActivity()
    }
}

private enum Text_ {
    private static func pick(_ pt: String, _ en: String, _ es: String) -> String {
        let lang = Locale.preferredLanguages.first?.prefix(2) ?? "pt"
        switch lang {
        case "en": return en
        case "es": return es
        default: return pt
        }
    }
    static var live: String { pick("AO VIVO", "LIVE", "EN VIVO") }
    static var endedLabel: String { pick("Encerrada", "Ended", "Terminó") }
    static var join: String { pick("Entrar", "Join", "Entrar") }
    static func isLive(_ name: String) -> String { pick("\(name) está ao vivo", "\(name) is live", "\(name) está en vivo") }
    static func ended(_ name: String) -> String { pick("\(name) encerrou a transmissão", "\(name) ended the stream", "\(name) terminó la transmisión") }
}

private let liveRed = Color(red: 0.94, green: 0.23, blue: 0.27)

/// Two letters for the compact island, where a name does not fit.
private func initials(_ name: String) -> String {
    let parts = name.split(separator: " ").prefix(2)
    let letters = parts.compactMap { $0.first }.map { String($0) }.joined()
    return letters.isEmpty ? "•" : letters.uppercased()
}

private struct LiveDot: View {
    let live: Bool
    var body: some View {
        Circle()
            .fill(live ? liveRed : Color.gray)
            .frame(width: 8, height: 8)
    }
}

private struct LiveBadge: View {
    let live: Bool
    var body: some View {
        HStack(spacing: 4) {
            LiveDot(live: live)
            Text(live ? Text_.live : Text_.endedLabel)
                .font(.caption2.weight(.bold))
                .foregroundStyle(live ? liveRed : Color.gray)
        }
    }
}

private struct JoinButton: View {
    let url: String
    var body: some View {
        if let destination = URL(string: url) {
            Link(destination: destination) {
                Text(Text_.join)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(liveRed))
            }
        }
    }
}

@available(iOS 16.2, *)
struct FriendLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FriendLiveAttributes.self) { context in
            // Lock screen and the banner on phones without an island.
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(Color.white.opacity(0.12))
                    Text(initials(context.attributes.name))
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    LiveBadge(live: context.state.live)
                    Text(context.state.live ? Text_.isLive(context.attributes.name) : Text_.ended(context.attributes.name))
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(context.attributes.roomTitle)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if context.state.live { JoinButton(url: context.attributes.url) }
            }
            .padding(16)
            .activityBackgroundTint(Color(red: 0.035, green: 0.035, blue: 0.043))
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: context.attributes.url))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveBadge(live: context.state.live)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.live { JoinButton(url: context.attributes.url) }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.live ? Text_.isLive(context.attributes.name) : Text_.ended(context.attributes.name))
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.attributes.roomTitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                LiveDot(live: context.state.live)
            } compactTrailing: {
                Text(initials(context.attributes.name))
                    .font(.caption2.weight(.bold))
            } minimal: {
                LiveDot(live: context.state.live)
            }
            .widgetURL(URL(string: context.attributes.url))
            .keylineTint(liveRed)
        }
    }
}
