import * as React from 'react';
import {
  Box,
  Icon,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Text,
  MenuDivider,
  MenuGroup,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Button,
  UnorderedList,
  ListItem,
  Link,
} from '@chakra-ui/react';
import { FaChevronDown } from 'react-icons/fa';
import { BiLinkExternal } from 'react-icons/bi';
import {
  appCluster,
  appRevision,
  appVersion,
  helpDeskUrl,
  helpChatUrl,
  helpIssueUrl,
  helpApiDocsUrl,
  helpSupportUrl,
  helpReleaseUrl,
  helpStatusUrl,
} from '@/shared/config';

const HelpMenu: React.FC = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Support Links</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <UnorderedList
              spacing={4}
              sx={{
                '& a': {
                  textDecor: 'underline',
                  color: 'bc-link',
                  _hover: {
                    textDecor: 'none',
                  },
                },
              }}
            >
              <ListItem>
                <Link
                  href={helpDeskUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Submit product and service requests using the Data Systems and
                  Services request system
                  <Icon as={BiLinkExternal} boxSize="4" ml={2} />
                </Link>
              </ListItem>
              <ListItem>
                <Link
                  href={helpChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chat with us in Rocket Chat
                  <Icon as={BiLinkExternal} boxSize="4" ml={2} />
                </Link>
              </ListItem>
              <ListItem>
                <Link
                  href={helpIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create an issue in Github
                  <Icon as={BiLinkExternal} boxSize="4" ml={2} />
                </Link>
              </ListItem>
            </UnorderedList>
          </ModalBody>

          <ModalFooter>
            <Button onClick={onClose}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Box
        as="span"
        d="flex"
        pr={0}
        alignItems="center"
        position="relative"
        zIndex={2}
      >
        <Menu placement="bottom-end">
          <MenuButton
            px={2}
            py={1}
            transition="all 0.2s"
            borderRadius={4}
            _hover={{ bg: 'bc-link' }}
            _expanded={{ bg: 'blue.400' }}
            _focus={{ boxShadow: 'outline' }}
            data-testid="help-dropdown-btn"
          >
            Help
            <Icon as={FaChevronDown} ml={2} aria-label="chevron down icon" />
          </MenuButton>
          <MenuList
            color="bc-component"
            sx={{
              'p.chakra-menu__group__title': {
                fontSize: 'md',
                fontWeight: 'normal !important',
                px: 1,
              },
            }}
          >
            <MenuGroup title="Documentation">
              <MenuItem
                as="a"
                color="bc-blue"
                href={helpApiDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="help-menu-api-docs"
              >
                Api Docs
                <Icon as={BiLinkExternal} boxSize="4" ml={2} />
              </MenuItem>
              <MenuItem
                as="a"
                color="bc-blue"
                href={helpSupportUrl}
                data-testid="help-menu-aps-support"
                target="_blank"
                rel="noopener noreferrer"
              >
                APS Support
                <Icon as={BiLinkExternal} boxSize="4" ml={2} />
              </MenuItem>
              <MenuItem
                as="a"
                color="bc-blue"
                href={helpReleaseUrl}
                rel="noopener noreferrer"
                data-testid="help-menu-release-notes"
                target="_blank"
              >
                Release Notes
                <Icon as={BiLinkExternal} boxSize="4" ml={2} />
              </MenuItem>
            </MenuGroup>
            <MenuDivider />
            <MenuGroup title="Contact Us">
              <MenuItem
                color="bc-blue"
                data-testid="help-menu-support"
                onClick={onOpen}
              >
                Support Links
              </MenuItem>
            </MenuGroup>
            <MenuDivider />
            <MenuGroup title="About">
              <MenuItem
                as="a"
                color="bc-blue"
                href={helpStatusUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="help-menu-status"
              >
                Status
                <Icon as={BiLinkExternal} boxSize="4" ml={2} />
              </MenuItem>
              <MenuItem
                isFocusable={false}
                as="div"
                flexDir="column"
                alignItems="flex-start"
                data-testid="help-menu-version"
              >
                <Text fontSize="xs">{`Version: ${appVersion} revision: ${appRevision.slice(
                  0,
                  9
                )}`}</Text>
                <Text fontSize="xs">{`Cluster: ${appCluster}`}</Text>
              </MenuItem>
            </MenuGroup>
          </MenuList>
        </Menu>
      </Box>
    </>
  );
};
export default HelpMenu;
