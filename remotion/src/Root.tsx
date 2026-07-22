import "./index.css";
import { KitchenDeskPromo } from "./Composition";
import { KitchenDeskVerticalPromo } from "./kitchendesk-vertical/KitchenDeskVerticalPromo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <KitchenDeskPromo />
      <KitchenDeskVerticalPromo />
    </>
  );
};
