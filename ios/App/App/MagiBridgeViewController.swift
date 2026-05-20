import Capacitor

@objc
public class MagiBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginType(MagiNativeLLMPlugin.self)
    }
}
