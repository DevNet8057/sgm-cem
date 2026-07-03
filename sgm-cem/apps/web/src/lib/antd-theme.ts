import type { ThemeConfig } from 'antd'
import { theme } from 'antd'

// Couleurs CEM (Culte d'Enfants de Melen)
const CEM_GREEN   = '#1A6B1A'
const CEM_DARK    = '#0F4A0F'
const CEM_YELLOW  = '#F5C400'

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary:        CEM_GREEN,
    colorSuccess:        '#10B981',
    colorError:          '#EF4444',
    colorInfo:           '#3B82F6',
    colorLink:           CEM_GREEN,
    colorLinkHover:      CEM_DARK,
    colorTextBase:       '#0F172A',
    colorBgBase:         '#FFFFFF',
    borderRadius:        10,
    borderRadiusLG:      14,
    borderRadiusSM:      8,
    fontFamily:          "'Montserrat', system-ui, sans-serif",
    fontSize:            14,
    // Couleur jaune CEM comme couleur secondaire via les CSS vars
    colorWarning:        CEM_YELLOW,
  },
  components: {
    Button: {
      primaryColor:        '#FFFFFF',
      defaultBorderColor:  CEM_GREEN,
      defaultColor:        CEM_GREEN,
    },
    Menu: {
      itemBg:              'transparent',
      itemColor:           'rgba(255,255,255,0.7)',
      itemHoverColor:      '#FFFFFF',
      itemSelectedColor:   CEM_DARK,
      itemSelectedBg:      CEM_YELLOW,
      itemActiveBg:        CEM_YELLOW,
      subMenuItemBg:       'transparent',
      darkItemColor:       'rgba(255,255,255,0.7)',
      darkItemHoverColor:  '#FFFFFF',
      darkItemSelectedColor: CEM_DARK,
      darkItemSelectedBg:  CEM_YELLOW,
    },
    Input: {
      activeBorderColor:   CEM_GREEN,
      hoverBorderColor:    CEM_GREEN,
      activeShadow:        `0 0 0 2px ${CEM_GREEN}30`,
    },
    Select: {
      optionSelectedBg:    '#E8F5E8',
      optionActiveBg:      '#F0FDF4',
    },
    Table: {
      headerBg:            '#F8FAFC',
      rowHoverBg:          '#F0FDF4',
    },
    Modal: {
      borderRadiusLG:      20,
    },
    Tag: {
      borderRadiusSM:      20,
    },
    Notification: {
      width:               320,
    },
  },
}

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary:        CEM_GREEN,
    colorSuccess:        '#10B981',
    colorWarning:        CEM_YELLOW,
    colorError:          '#EF4444',
    colorInfo:           '#3B82F6',
    colorLink:           '#4ADE80',
    colorLinkHover:      '#86EFAC',
    borderRadius:        10,
    borderRadiusLG:      14,
    borderRadiusSM:      8,
    fontFamily:          "'Montserrat', system-ui, sans-serif",
    fontSize:            14,
  },
  components: {
    Button: {
      primaryColor: '#FFFFFF',
    },
    Menu: {
      itemBg:              'transparent',
      itemColor:           'rgba(255,255,255,0.7)',
      itemHoverColor:      '#FFFFFF',
      itemSelectedColor:   CEM_DARK,
      itemSelectedBg:      CEM_YELLOW,
      darkItemSelectedBg:  CEM_YELLOW,
      darkItemSelectedColor: CEM_DARK,
    },
    Input: {
      activeBorderColor:   CEM_GREEN,
      hoverBorderColor:    CEM_GREEN,
      activeShadow:        `0 0 0 2px ${CEM_GREEN}30`,
    },
    Select: {
      optionSelectedBg:    '#1A3D1A',
    },
    Table: {
      headerBg:            '#1E293B',
      rowHoverBg:          '#1A3D1A',
    },
    Notification: {
      width: 320,
    },
  },
}
