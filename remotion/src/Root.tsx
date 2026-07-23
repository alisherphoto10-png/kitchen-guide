import "./index.css";
import { KitchenDeskPromo } from "./Composition";
import { KitchenDeskVerticalPromo } from "./kitchendesk-vertical/KitchenDeskVerticalPromo";
import { KitchenDeskChecklistReel } from "./kitchendesk-checklist/KitchenDeskChecklistReel";
import { AudioPipelineDemo } from "./audio-demo/AudioPipelineDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <KitchenDeskPromo />
      <KitchenDeskVerticalPromo />
      <KitchenDeskChecklistReel />
      <AudioPipelineDemo />
    </>
  );
};
