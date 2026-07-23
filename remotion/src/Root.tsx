import "./index.css";
import { KitchenDeskPromo } from "./Composition";
import { KitchenDeskVerticalPromo } from "./kitchendesk-vertical/KitchenDeskVerticalPromo";
import { KitchenDeskChecklistReel } from "./kitchendesk-checklist/KitchenDeskChecklistReel";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <KitchenDeskPromo />
      <KitchenDeskVerticalPromo />
      <KitchenDeskChecklistReel />
    </>
  );
};
